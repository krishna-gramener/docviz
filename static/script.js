import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/+esm";
import { Marked } from "https://cdn.jsdelivr.net/npm/marked@13/+esm";
import * as XLSX from "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";
pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs";
import pptxgenjs from "https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/+esm";
import { default as html2canvas } from "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.esm.js";

// State
let uploadedFiles = [];
let conversation = [];
let context = "";
let isProcessing = false;

// DOM Elements
const fileInput = document.getElementById("fileInput");
const dropZone = document.getElementById("dropZone");
const fileList = document.getElementById("fileList");
const chatContainer = document.getElementById("chatContainer");
const userInput = document.getElementById("userInput");
const sendMessage = document.getElementById("sendMessage");
const clearChat = document.getElementById("clearChat");
const exportChat = document.getElementById("exportChat");
const downloadPPT = document.getElementById("downloadPPT");
const loadingMessage = document.getElementById("loadingMessage");
const clearFiles = document.getElementById("clearFiles");

// Bootstrap Components
const loadingModal = new bootstrap.Modal(document.getElementById("loadingModal"));
const marked = new Marked();

// Event Listeners
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (e) => e.preventDefault());
dropZone.addEventListener("drop", handleFileDrop);
fileInput.addEventListener("change", handleFileSelect);
sendMessage.addEventListener("click", handleSendMessage);
clearChat.addEventListener("click", clearConversation);
exportChat.addEventListener("click", exportConversation);
downloadPPT.addEventListener("click", generatePPTFromTemplates);
userInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") handleSendMessage();
});

clearFiles.addEventListener("click", () => {
  uploadedFiles = [];
  updateFileList();
  conversation = [];
  updateChat();
  if (!exportChat.classList.contains("d-none")) exportChat.classList.add("d-none");
  if (!downloadPPT.classList.contains("d-none")) downloadPPT.classList.add("d-none");
});

// File Handling
async function handleFileDrop(e) {
  e.preventDefault();
  dropZone.classList.remove("bg-secondary");
  const files = e.dataTransfer.files;
  await processFiles(files);
}

async function handleFileSelect(e) {
  await processFiles(e.target.files);
}

async function processFiles(files) {
  loadingModal.show();
  loadingMessage.textContent = "Processing files...";

  try {
    for (const file of files) {
      const fileData = {
        name: file.name,
        type: file.type,
        content: await extractFileContent(file),
      };
      uploadedFiles.push(fileData);
    }

    updateFileList();
    await initializeConversation();
  } catch (error) {
    showError("Error processing files: " + error.message);
  } finally {
    loadingModal.hide();
  }
}

function convertImageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result); // This will be the Base64 string
    };
    reader.onerror = (error) => {
      reject(error);
    };
    reader.readAsDataURL(file); // Reads the file as a Data URL (Base64)
  });
}

async function extractFileContent(file) {
  try {
    // File type detection - use both MIME type and extension
    const fileType = file.type || "";
    const fileName = file.name || "";
    const extension = fileName.split(".").pop().toLowerCase();

    // Handler mapping for different file types
    const handlers = {
      // PDF Handler
      pdf: async () => {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument(arrayBuffer).promise;
        const textPromises = [];

        // Process all pages in parallel
        for (let i = 1; i <= pdf.numPages; i++) {
          textPromises.push(
            (async () => {
              const page = await pdf.getPage(i);
              const content = await page.getTextContent();
              return content.items.map((item) => item.str).join(" ");
            })()
          );
        }

        // Wait for all pages to be processed
        const pageTexts = await Promise.all(textPromises);
        return pageTexts.join(" ");
      },

      // Image Handler
      image: async () => {
        const base64Image = await convertImageToBase64(file);
        return await sendImageToLLM(base64Image, file.type);
      },

      // Excel Handler
      excel: async () => {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: "array" });
        return processWorkbook(workbook);
      },

      // CSV Handler
      csv: async () => {
        const text = await file.text();
        const workbook = XLSX.read(text, { type: "string" });
        return processWorkbook(workbook);
      },

      // DOCX Handler
      docx: async () => {
        const arrayBuffer = await file.arrayBuffer();
        const result = await window.mammoth.extractRawText({ arrayBuffer });
        return result.value || "";
      },

      // Default text handler
      text: async () => {
        return await file.text();
      },
    };

    // Helper function for processing workbooks (used by both Excel and CSV)
    function processWorkbook(workbook) {
      let text = "";
      workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        text += jsonData.map((row) => row.join("\t")).join("\n") + "\n";
      });
      return text;
    }

    // Determine which handler to use
    let handler;
    if (fileType.includes("pdf") || extension === "pdf") {
      handler = handlers.pdf;
    } else if (fileType.includes("image/") || ["jpg", "jpeg", "png", "webp", "gif"].includes(extension)) {
      handler = handlers.image;
    } else if (["xlsx", "xls"].includes(extension)) {
      handler = handlers.excel;
    } else if (fileType.includes("csv") || extension === "csv") {
      handler = handlers.csv;
    } else if (extension === "docx") {
      handler = handlers.docx;
    } else {
      handler = handlers.text;
    }

    // Execute the appropriate handler
    return await handler();
  } catch (error) {
    console.error(`Error extracting content from ${file.name}:`, error);
    throw new Error(`Failed to extract content from ${file.name}: ${error.message}`);
  }
}

async function sendImageToLLM(base64Image, fileType) {
  try {
    const response = await fetch(
      "https://llmfoundry.straive.com/gemini/v1beta/models/gemini-1.5-flash-8b:streamGenerateContent?alt=sse",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          system_instruction: {
            parts: [
              {
                text: "You are a helpful assistant. Make sure to return data in JSON format only.",
              },
            ],
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  inline_data: {
                    mime_type: fileType,
                    data: base64Image.split(",")[1],
                  },
                },
                {
                  text: "extract necessary details from this. If its a graph draw some insights from it",
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
          },
        }),
      }
    );

    const reader = response.body.getReader();
    let resultText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Convert the Uint8Array to a string
      const chunk = new TextDecoder("utf-8").decode(value);
      // Split the chunk into lines and process each line
      chunk.split("\n").forEach((line) => {
        if (line.startsWith("data: ")) {
          const jsonString = line.slice(6); // Remove "data: " prefix
          try {
            const jsonResponse = JSON.parse(jsonString);
            // Process the jsonResponse as needed
            resultText += jsonResponse.candidates
              .map((candidate) => candidate.content.parts.map((part) => part.text).join(""))
              .join("\n");
          } catch (e) {
            console.error("Error parsing JSON:", e);
          }
        }
      });
    }
    return resultText; // Return the accumulated text from the response
  } catch (error) {
    console.error("Error sending image to LLM: ", error);
    throw error;
  }
}

function updateFileList() {
  fileList.innerHTML = uploadedFiles
    .map(
      (file) => `
        <div class="alert alert-secondary">
            <i class="bi bi-file-earmark"></i> ${file.name}
        </div>
    `
    )
    .join("");
}

function updateContext() {
  const data = uploadedFiles
    .map((file) => {
      return `File: ${file.name}\nContent: ${file.content}\n\n`;
    })
    .join("");
  return data;
}

// Conversation Handling
async function initializeConversation() {
  if (uploadedFiles.length === 0) return;

  exportChat.classList.remove("d-none");
  downloadPPT.classList.remove("d-none");
  loadingModal.show();
  loadingMessage.textContent = "Analyzing files...";

  try {
    const response = await fetch("https://llmfoundry.straive.com/gemini/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        model: "gemini-1.5-flash-8b",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant. Analyze the provided files and give a summary. Be concise but informative.",
          },
          { role: "user", content: updateContext() },
        ],
      }),
    });

    const result = await response.json();
    if (result.error) throw new Error(result.error.message);

    const summary = result.choices?.[0]?.message?.content;
    addMessage("assistant", summary);
  } catch (error) {
    showError("Error initializing conversation: " + error.message);
  } finally {
    loadingModal.hide();
  }
}

async function handleSendMessage() {
  const message = userInput.value.trim();
  if (!message) return;

  addMessage("user", message);
  userInput.value = "";
  loadingModal.show();
  loadingMessage.textContent = "Getting response...";
  try {
    const response = await fetch("https://llmfoundry.straive.com/gemini/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        model: "gemini-1.5-flash-8b",
        messages: [
          {
            role: "system",
            content: `You are a helpful assistant. You will converse with the user. Act like a human.
            The user will ask you questions based on the context provided.
            Refer the provided context and conversation to answer user question.
            This is the CONTEXT of all the files: ${updateContext()} and 
            this is the CONVERSATION so far: ${conversation}`,
          },
          { role: "user", content: message },
        ],
      }),
    });

    const result = await response.json();
    if (result.error) throw new Error(result.error.message);

    const reply = result.choices?.[0]?.message?.content;
    addMessage("assistant", reply);
  } catch (error) {
    showError("Error getting response: " + error.message);
  } finally {
    loadingModal.hide();
  }
}

function addMessage(role, content) {
  conversation.push({ role, content });
  updateChat();
}

function updateChat() {
  chatContainer.innerHTML = conversation
    .map(
      (msg) => `
        <div class="message ${msg.role}-message">
            <div class="message-header">
                <strong>${msg.role === "user" ? "You" : "Assistant"}</strong>
            </div>
            <div class="message-content">${marked.parse(msg.content)}</div>
        </div>
    `
    )
    .join("");
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function clearConversation() {
  conversation = [];
  updateChat();
  if (!exportChat.classList.contains("d-none")) exportChat.classList.add("d-none");
  if (!downloadPPT.classList.contains("d-none")) downloadPPT.classList.add("d-none");
}

function exportConversation() {
  const text = conversation.map((msg) => `${msg.role}: ${msg.content}`).join("\n\n");

  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "conversation.txt";
  a.click();
  URL.revokeObjectURL(url);
}

function showError(message) {
  const alert = document.createElement("div");
  alert.className = "alert alert-danger alert-dismissible fade show";
  alert.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
  document.body.insertAdjacentElement("beforeend", alert);
  setTimeout(() => alert.remove(), 5000);
}

// PPT Generation Functions
async function generatePPTFromTemplates() {
  if (uploadedFiles.length === 0) {
    showError("Please upload files before generating a presentation");
    return;
  }

  loadingModal.show();
  loadingMessage.textContent = "Generating presentation content...";

  try {
    // Load configuration
    const config = await loadConfig();
    
    // Get presentation content from LLM
    const presentationData = await getPresentationContentFromLLM();
    
    // Create and download the presentation
    await createAndDownloadPresentation(presentationData, config);
    
  } catch (error) {
    console.error("Error generating presentation:", error);
    showError("Error generating presentation: " + error.message);
  } finally {
    loadingModal.hide();
  }
}

async function loadConfig() {
  try {
    const response = await fetch('/config.json');
    if (!response.ok) throw new Error('Failed to load configuration');
    return await response.json();
  } catch (error) {
    console.error('Error loading config:', error);
    throw error;
  }
}

async function getPresentationContentFromLLM() {
  try {
    const response = await fetch('https://llmfoundry.straive.com/gemini/v1beta/openai/chat/completions', {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        model: "gemini-1.5-flash-8b",
        messages: [
          {
            role: "system",
            content: `You are a presentation expert. Create a professional presentation based on the provided documents.

IMPORTANT: You MUST create EXACTLY 5 slides in EXACTLY this order:
1. First slide: type "content" - a general overview or introduction
2. Second slide: type "image-text" - a slide with text content
3. Third slide: type "comparison" - a slide comparing two aspects
4. Fourth slide: type "quote" - a slide with a notable quote
5. Fifth slide: type "conclusion" - a summary slide with takeaways

Return a JSON object with the following structure:
{
  "title": "Main presentation title",
  "subtitle": "Presentation subtitle",
  "slides": [
    {
      "type": "content",
      "title": "Introduction",
      "content": ["Bullet point 1", "Bullet point 2", "Bullet point 3"]
    },
    {
      "type": "image-text",
      "title": "Visual Analysis",
      "content": ["Text point 1", "Text point 2", "Text point 3"]
    },
    {
      "type": "comparison",
      "title": "Comparative Analysis",
      "leftTitle": "First Aspect",
      "rightTitle": "Second Aspect",
      "leftContent": ["Point 1", "Point 2"],
      "rightContent": ["Point 1", "Point 2"]
    },
    {
      "type": "quote",
      "title": "Key Insight",
      "quote": "Important quote from the document",
      "source": "Source of the quote"
    },
    {
      "type": "conclusion",
      "title": "Key Takeaways",
      "content": ["Summary point 1", "Summary point 2",....],
      "takeaways": ["Takeaway 1", "Takeaway 2", "Takeaway 3",....],
      "call-to-action": "Next steps or action item"
    }
  ]
}

Make the presentation informative, well-structured, and highlight the most important information from the documents. 
DO NOT deviate from this exact structure and slide types.`
          },
          { role: "user", content: updateContext() }
        ]
      })
    });

    const result = await response.json();
    if (result.error) throw new Error(result.error.message);

    const contentString = result.choices?.[0]?.message?.content;
    
    // Extract JSON from the response
    const jsonMatch = contentString.match(/```json\n([\s\S]*?)\n```/) || 
                      contentString.match(/```([\s\S]*?)```/) ||
                      [null, contentString];
    let presentationData;
    try {
      presentationData = JSON.parse(jsonMatch[1] || contentString);
    } catch (e) {
      console.error("Error parsing JSON:", e);
      throw new Error("Failed to parse presentation data");
    }
    return presentationData;
  } catch (error) {
    console.error("Error getting presentation content:", error);
    throw error;
  }
}

async function createAndDownloadPresentation(presentationData, config) {
  try {
    loadingMessage.textContent = "Creating presentation...";
    
    // Initialize pptxgenjs
    const pptx = new pptxgenjs();
    
    // Set presentation properties
    pptx.layout = config.presentationDefaults.layout;
    pptx.title = presentationData.title || config.presentationDefaults.title;
    pptx.author='Gramener';
    // Create title slide using the title and subtitle from the data
    await createSlideFromTemplate(pptx, "title", {
      title: presentationData.title || config.presentationDefaults.title,
      subtitle: presentationData.subtitle || config.presentationDefaults.subtitle,
      date: new Date().toLocaleDateString()
    }, config);
    
    // Create content slides based on the data
    for (const slide of presentationData.slides) {
      const slideType = slide.type || "content";
      
      // Create slide based on template and data
      await createSlideFromTemplate(pptx, slideType, slide, config);
    }
    
    // Save the presentation
    pptx.writeFile({ fileName: config.presentationDefaults.fileName });
    
  } catch (error) {
    console.error("Error creating presentation:", error);
    throw error;
  }
}

async function createSlideFromTemplate(pptx, slideType, data, config) {
  try {
    // Get template details from config
    const templateConfig = config.slideTemplates[slideType];
    if (!templateConfig) {
      console.warn(`Template configuration not found for slide type: ${slideType}, using content slide as fallback`);
      const fallbackConfig = config.slideTemplates["content"];
      if (!fallbackConfig) {
        throw new Error("No fallback template available");
      }
      
      // Load the fallback template HTML
      const response = await fetch(fallbackConfig.path);
      if (!response.ok) throw new Error(`Failed to load fallback template`);
      let html = await response.text();
      
      // Process the slide with the fallback template
      processSlideHtml(html, data, "content", pptx);
      return;
    }
    
    // Load the template HTML
    const response = await fetch(templateConfig.path);
    if (!response.ok) throw new Error(`Failed to load template: ${templateConfig.name}`);
    let html = await response.text();
    
    // Process the slide with the appropriate template
    processSlideHtml(html, data, slideType, pptx);
    
  } catch (error) {
    console.error(`Error creating slide from template ${slideType}:`, error);
  }
}

async function processSlideHtml(html, data, slideType, pptx) {
  // Create a temporary container and parse the HTML
  const tempContainer = document.createElement('div');
  tempContainer.innerHTML = html;
  
  // Find all elements with data-name attributes
  const elements = tempContainer.querySelectorAll('[data-name]');
  
  // Process each element
  elements.forEach(element => {
    const dataName = element.getAttribute('data-name');
    
    // Get the corresponding data value
    const value = data[dataName];
    
    if (value !== undefined) {
      if (typeof value === 'string' || typeof value === 'number') {
        // Handle simple string/number values
        element.innerHTML = value;
      } else if (Array.isArray(value)) {
        // Handle arrays (bullet points)
        const bulletPoints = value.map(item => `• ${item}`).join('<br>');
        element.innerHTML = bulletPoints;
      }
    }
    
    // Handle special naming conventions (leftContent -> left-content)
    const camelCaseName = dataName.replace(/-([a-z])/g, g => g[1].toUpperCase());
    if (data[camelCaseName] !== undefined) {
      const value = data[camelCaseName];
      if (Array.isArray(value)) {
        element.innerHTML = value.map(item => `• ${item}`).join('<br>');
      } else {
        element.innerHTML = value;
      }
    }
  });

  // Add the container to the document temporarily (required for html2canvas)
  tempContainer.style.position = 'absolute';
  tempContainer.style.left = '-9999px';
  document.body.appendChild(tempContainer);

  try {
    // Convert HTML to canvas
    const canvas = await html2canvas(tempContainer, {
      backgroundColor: null,
      scale: 2, // Higher resolution
      logging: false,
      width: 1200, // PowerPoint standard width
      height: 675  // PowerPoint standard height (16:9)
    });

    // Convert canvas to base64 image
    const imageData = canvas.toDataURL('image/png');

    // Create a new slide
    const slide = pptx.addSlide();
    
    // Add the image to cover the entire slide
    slide.addImage({
      data: imageData,
      x: 0,
      y: 0,
      w: '100%',
      h: '100%'
    });

  } finally {
    // Clean up: remove the temporary container
    document.body.removeChild(tempContainer);
  }
}
