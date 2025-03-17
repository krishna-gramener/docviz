import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/+esm";
import { Marked } from "https://cdn.jsdelivr.net/npm/marked@13/+esm";
import * as XLSX from "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";
pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs";
import pptxgenjs from "https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/+esm";
import { default as html2canvas } from "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.esm.js";

// State
let uploadedFiles = [];
let conversation = [];

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
document.addEventListener("DOMContentLoaded", () => {
  // Initialize libraries
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs";

  // Load configuration
  loadConfig();

  // File handling events
  if (dropZone) {
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("border-primary");
    });

    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("border-primary");
    });

    dropZone.addEventListener("drop", handleFileDrop);

    dropZone.addEventListener("click", () => {
      if (fileInput) {
        fileInput.click();
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener("change", handleFileSelect);
  }

  if (clearFiles) {
    clearFiles.addEventListener("click", () => {
      uploadedFiles = [];
      updateFileList();
      clearConversation();
    });
  }

  // Conversation events
  if (userInput) {
    userInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        handleSendMessage();
      }
    });
  }

  if (sendMessage) {
    sendMessage.addEventListener("click", handleSendMessage);
  }

  if (clearChat) {
    clearChat.addEventListener("click", clearConversation);
  }

  if (exportChat) {
    exportChat.addEventListener("click", exportConversation);
  }

  // PPT generation event
  if (downloadPPT) {
    downloadPPT.addEventListener("click", async () => {
      try {
        loadingModal.show();
        loadingMessage.textContent = "Generating presentation...";

        // Get presentation content from LLM
        const presentationData = await getPresentationContentFromLLM();

        // Generate and download the presentation
        await generatePresentation(presentationData, {});
      } catch (error) {
        showError("Error generating presentation: " + error.message);
        console.error(error);
      } finally {
        loadingModal.hide();
      }
    });
  }
});

// File Handling
async function handleFileDrop(e) {
  e.preventDefault();
  if (dropZone) {
    dropZone.classList.remove("bg-secondary");
  }
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
  if (fileList) {
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

  exportChat?.classList.remove("d-none");
  downloadPPT?.classList.remove("d-none");
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
  const message = userInput?.value.trim();
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
  if (chatContainer) {
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
}

function clearConversation() {
  conversation = [];
  updateChat();
  if (exportChat && !exportChat.classList.contains("d-none")) {
    exportChat.classList.add("d-none");
  }
  if (downloadPPT && !downloadPPT.classList.contains("d-none")) {
    downloadPPT.classList.add("d-none");
  }
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
async function generatePresentation(presentationData, config) {
  try {
    // Initialize pptxgenjs
    const pptx = new pptxgenjs();

    // Set default config if not provided
    const defaultConfig = {
      presentationDefaults: {
        layout: "LAYOUT_16x9",
        title: "Generated Presentation",
      },
      slideTemplates: {
        title: {
          path: "/templates/html/title-slide.html",
          background: "#ffffff",
        },
        content: {
          path: "/templates/html/content-slide.html",
          background: "#ffffff",
        },
        conclusion: {
          path: "/templates/html/conclusion-slide.html",
          background: "#ffffff",
        },
      },
    };
    // Merge provided config with defaults
    config = { ...defaultConfig, ...config };

    // Ensure slideTemplates is properly merged (deep merge for nested objects)
    if (!config.slideTemplates) {
      config.slideTemplates = defaultConfig.slideTemplates;
    }

    // We'll set the presentation properties after loading the first template
    // to ensure dimensions match the template

    // Create a temporary container for processing slides
    const tempContainer = document.createElement("div");
    tempContainer.style.position = "absolute";
    tempContainer.style.left = "-9999px";
    tempContainer.style.top = "-9999px";
    document.body.appendChild(tempContainer);

    // Load the first template to get dimensions
    let templateDimensions = null;
    let firstTemplateConfig = null;
    
    // Find the first valid template to use for dimensions
    for (const slideType in config.slideTemplates) {
      firstTemplateConfig = config.slideTemplates[slideType];
      if (firstTemplateConfig && firstTemplateConfig.path) {
        break;
      }
    }
    
    if (firstTemplateConfig) {
      try {
        const templatePath = firstTemplateConfig.path.startsWith("/")
          ? window.location.origin + firstTemplateConfig.path
          : window.location.origin + "/" + firstTemplateConfig.path;
          
        const response = await fetch(templatePath);
        if (response.ok) {
          const templateHTML = await response.text();
          tempContainer.innerHTML = templateHTML;
          
          // Wait a moment for styles to apply
          await new Promise((resolve) => setTimeout(resolve, 50));
          
          const rootElement = tempContainer.firstChild;
          if (rootElement) {
            const rect = rootElement.getBoundingClientRect();
            templateDimensions = {
              width: rect.width,
              height: rect.height
            };
            
            // Set custom slide size based on template dimensions
            pptx.defineLayout({
              name: 'CUSTOM_LAYOUT',
              width: templateDimensions.width / 96,  // Convert pixels to inches (96 DPI)
              height: templateDimensions.height / 96
            });
            pptx.layout = 'CUSTOM_LAYOUT';
            
            // Set other presentation properties
            pptx.title = presentationData.slides[0]?.title || config.presentationDefaults.title;
            pptx.author = 'Gramener';
          }
        }
      } catch (error) {
        console.error("Error loading first template for dimensions:", error);
        // Fall back to default layout
        pptx.layout = config.presentationDefaults.layout;
      }
    }

    // Process each slide
    for (let i = 0; i < presentationData.slides.length; i++) {
      const slideData = presentationData.slides[i];
      const slideType = slideData.type || "content"; // Default to content if no type specified

      // Add slide number for content slides
      if (slideType === "content") {
        slideData["slide-number"] = i + 1;
      }

      // Add current date for title slides if not provided
      if (slideType === "title") {
        const now = new Date();
        const day = now.getDate();
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
        const month = monthNames[now.getMonth()];
        const year = now.getFullYear();
        slideData.date = `${day} ${month} ${year}`;
      }

      // Get the template configuration for this slide type
      let templateConfig = config.slideTemplates[slideType];
      if (!templateConfig) {
        console.warn(`Template not found for slide type: ${slideType}. Using content template as fallback.`);
        // Use content template as fallback
        const fallbackType = "content";
        templateConfig = config.slideTemplates[fallbackType];

        if (!templateConfig) {
          console.error(`Fallback template not found either. Skipping slide ${i + 1}.`);
          continue;
        }
      }

      try {
        // 1. Load the template HTML
        const templatePath = templateConfig.path.startsWith("/")
          ? window.location.origin + templateConfig.path
          : window.location.origin + "/" + templateConfig.path;

        try {
          const response = await fetch(templatePath);
          if (!response.ok) {
            console.error(`Failed to load template: ${templateConfig.path} (Status: ${response.status})`);
            continue;
          }

          // Get the template HTML
          const templateHTML = await response.text();
          // 2. Create a temporary DOM element with the template
          tempContainer.innerHTML = templateHTML;

          // Wait a moment for styles to apply
          await new Promise((resolve) => setTimeout(resolve, 50));
        } catch (error) {
          console.error(`Error fetching template: ${error.message}`);
          continue;
        }

        // Get the root element of the template
        const rootElement = tempContainer.firstChild;

        // Check if root element exists
        if (!rootElement) {
          console.error(`No root element found in template for slide ${i + 1}. Template may be empty or invalid.`);
          continue;
        }

        const rootRect = rootElement.getBoundingClientRect();

        // Create a new PowerPoint slide
        const slide = pptx.addSlide();

        // Set slide background based on slide type
        if (slideType === "conclusion") {
          slide.background = { color: "2C3E50" };
        } else if (slideType === "title") {
          slide.background = { color: "1F2937" };
        } else {
          slide.background = { color: "FFFFFF" };
        }

        // 3. Find all placeholders in the template
        const placeholders = rootElement.querySelectorAll("[data-name]");
        // 4. Process each placeholder
        placeholders.forEach((placeholder) => {
          const placeholderName = placeholder.getAttribute("data-name");
          const placeholderValue = slideData[placeholderName] || "";
          
          // Skip if no value provided for this placeholder
          if (placeholderValue === undefined || placeholderValue === null) {
            return;
          }

          // Get placeholder position relative to the slide
          const rect = placeholder.getBoundingClientRect();
          const dpi = 96; // PowerPoint uses 96 dpi
          
          // Calculate position as a percentage of the template dimensions
          // This ensures elements are positioned correctly regardless of slide size
          const position = {
            x: (rect.left - rootRect.left) / rootRect.width * 100 / 100 * (templateDimensions.width / dpi),
            y: (rect.top - rootRect.top) / rootRect.height * 100 / 100 * (templateDimensions.height / dpi),
            w: rect.width / rootRect.width * 100 / 100 * (templateDimensions.width / dpi),
            h: rect.height / rootRect.height * 100 / 100 * (templateDimensions.height / dpi)
          };

          // Handle different types of placeholders
          if (placeholder.tagName.toLowerCase() === "img") {
            // Handle image placeholder
            if (typeof placeholderValue === "string" && placeholderValue.startsWith("http")) {
              // Calculate the displayed dimensions based on object-fit: contain
              const imgPosition = { ...position };

              // If the style has an object-fit: contain, use the natural dimensions of the image
              if (placeholder.style.objectFit === "contain") {
                // Get the natural dimensions of the image
                const naturalWidth = placeholder.naturalWidth;
                const naturalHeight = placeholder.naturalHeight;

                // Calculate the aspect ratio of the image
                const imageRatio = naturalWidth / naturalHeight;
                const containerRatio = rect.width / rect.height;

                // Adjust dimensions based on object-fit: contain logic
                if (imageRatio > containerRatio) {
                  // Image is wider than container (relative to height)
                  const displayedHeight = rect.width / imageRatio;
                  imgPosition.y += (rect.height - displayedHeight) / 2 / dpi;
                  imgPosition.h = displayedHeight / dpi;
                } else {
                  // Image is taller than container (relative to width)
                  const displayedWidth = rect.height * imageRatio;
                  imgPosition.x += (rect.width - displayedWidth) / 2 / dpi;
                  imgPosition.w = displayedWidth / dpi;
                }
              }

              slide.addImage({
                ...imgPosition,
                path: placeholderValue,
              });
            }
          } else {
            // Get computed style for the placeholder
            const computed = window.getComputedStyle(placeholder);
            const bgColor = rgbToHex(computed.backgroundColor);

            // Extract transparency from rgba background if present
            let transparency = 0;
            const bgMatch = computed.backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/);
            if (bgMatch && bgMatch[4] !== undefined) transparency = Math.round((1 - parseFloat(bgMatch[4])) * 100);

            // Handle text placeholders
            const textOptions = {
              ...position,
              fontSize: (parseFloat(computed.fontSize) / dpi) * 96,
              color: rgbToHex(computed.color),
              fill: { color: bgColor, transparency },
              bold: computed.fontWeight === "bold" || parseInt(computed.fontWeight) >= 700,
              italic: computed.fontStyle === "italic",
              underline: computed.textDecorationLine.includes("underline"),
              align: computed.textAlign || "left",
            };

            if (Array.isArray(placeholderValue)) {
              // Handle array values as bullet points
              slide.addText(placeholderValue.map((item) => `• ${String(item)}`).join("\n"), {
                ...textOptions,
                bullet: { type: "bullet" },
              });
            } else {
              // Handle regular text
              const textValue = String(placeholderValue);
              slide.addText(textValue, textOptions);
            }
          }
        });

        // Clear the temporary container
        tempContainer.innerHTML = "";
      } catch (error) {
        console.error(`Error processing slide ${i + 1}:`, error);
        // Add a slide with error message
        const slide = pptx.addSlide();
        slide.addText(`Error processing slide ${i + 1}: ${error.message}`, {
          x: 1,
          y: 1,
          w: 8,
          h: 4,
          fontSize: 14,
          color: "FF0000",
        });
      }
    }

    // Remove the temporary container
    document.body.removeChild(tempContainer);

    // Save the presentation
    pptx.writeFile({ fileName: "DocViz_Presentation.pptx" });
  } catch (error) {
    console.error("Error generating presentation:", error);
    throw error;
  }
}

// Helper function to convert RGB color to hex
function rgbToHex(rgb) {
  const result = rgb.match(/\d+/g);
  if (!result) return "000000";
  return result
    .slice(0, 3)
    .map((x) => {
      let hex = parseInt(x).toString(16);
      return hex.length === 1 ? "0" + hex : hex;
    })
    .join("");
}

async function loadConfig() {
  try {
    const response = await fetch("/config.json");
    if (!response.ok) throw new Error("Failed to load configuration");
    return await response.json();
  } catch (error) {
    console.error("Error loading config:", error);
    throw error;
  }
}

async function getPresentationContentFromLLM() {
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
            content: `You are a presentation expert. Create a professional presentation based on the provided documents.

IMPORTANT: You MUST create a presentation with AT MOST 5 slides following these rules:
1. First slide: type "title" - must be the first slide and appear exactly once
2. Middle slides: type "content" - can appear multiple times (1-3 slides)
3. Last slide: type "conclusion" - must be the last slide and appear exactly once

Return a JSON object with the following structure:
{
  "slides": [
    {
      "type": "title",
      "title": "Main presentation title [4-5 words]",
      "subtitle": "Presentation subtitle [4-5 words]"
    },
    {
      "type": "content",
      "title": "Content Section Title",
      "content": ["Bullet point 1", "Bullet point 2", "Bullet point 3", "Bullet point 4", "Bullet point 5"]
    },
    {
      "type": "conclusion",
      "title": "Conclusion",
      "takeaways": ["Key takeaway 1", "Key takeaway 2", "Key takeaway 3", "Key takeaway 4"...],
      "call-to-action": "Next steps or action item"
    }
  ]
}

Make the presentation informative, well-structured, and highlight the most important information from the documents. 
DO NOT deviate from this exact structure and slide types.
Remember that the title slide must be first, conclusion slide must be last, and content slides can appear 1-3 times in between.
The total number of slides must not exceed 5.`,
          },
          { role: "user", content: updateContext() },
        ],
      }),
    });

    const result = await response.json();
    if (result.error) throw new Error(result.error.message);

    const contentString = result.choices?.[0]?.message?.content;

    // Extract JSON from the response
    const jsonMatch = contentString.match(/```json\n([\s\S]*?)\n```/) ||
      contentString.match(/```([\s\S]*?)```/) || [null, contentString];
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
