import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/+esm";
import { Marked } from "https://cdn.jsdelivr.net/npm/marked@13/+esm";
import * as XLSX from "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";
pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs";

// State
let uploadedFiles = [];
let conversation = [];
let context = "";
const loadingModal = new bootstrap.Modal(document.getElementById("loadingModal"));
const marked = new Marked();
// DOM Elements
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const fileList = document.getElementById("fileList");
const chatContainer = document.getElementById("chatContainer");
const userInput = document.getElementById("userInput");
const sendMessage = document.getElementById("sendMessage");
const clearChat = document.getElementById("clearChat");
const exportChat = document.getElementById("exportChat");
const loadingMessage = document.getElementById("loadingMessage");
const clearFiles = document.getElementById("clearFiles");

// Event Listeners
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("bg-secondary");
});
dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("bg-secondary");
});
dropZone.addEventListener("drop", handleFileDrop);
fileInput.addEventListener("change", handleFileSelect);
sendMessage.addEventListener("click", handleSendMessage);
clearChat.addEventListener("click", clearConversation);
exportChat.addEventListener("click", exportConversation);
userInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") handleSendMessage();
});

clearFiles.addEventListener("click", () => {
  uploadedFiles = [];
  updateFileList();
  conversation = [];
  updateChat();
  if (!exportChat.classList.contains("d-none")) exportChat.classList.add("d-none");
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
      //   console.log("FileData: ", fileData);
      uploadedFiles.push(fileData);
      //   console.log("Uploaded Files: ", uploadedFiles);
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
    const fileType = file.type || "";
    if (fileType.includes("pdf")) {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument(arrayBuffer).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item) => item.str).join(" ");
      }
      return text;
    } else if (fileType.includes("image/jpeg") || fileType.includes("image/png") || fileType.includes("image/webp")) {
      const base64Image = await convertImageToBase64(file);
      const extractedText = await sendImageToLLM(base64Image, file.type);
      return extractedText;
    } else if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      let text = "";
      workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        text += jsonData.map((row) => row.join("\t")).join("\n") + "\n";
      });
      return text;
    } else if (fileType.includes("csv")) {
      const text = await file.text();
      const workbook = XLSX.read(text, { type: "string" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const extractedText = jsonData.map((row) => row.join("\t")).join("\n");
      console.log("CSV Extracted Text: ", extractedText);
      return extractedText;
    } else if (file.name.endsWith(".docx")) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const result = await window.mammoth.extractRawText({ arrayBuffer });
        const text = result.value || "";
        return text;
      } catch (error) {
        console.error("Error extracting DOCX content:", error);
        throw new Error("Failed to extract text from DOCX file");
      }
    } else {
      const text = await file.text();
      return text;
    }
  } catch (error) {
    console.error("Error extracting file content:", error);
    throw new Error("Failed to extract file content");
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
    // console.log("Result Text: ",resultText);
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
  context = updateContext();
  //   console.log("Context: ", context);
  if (uploadedFiles.length === 0) return;

  exportChat.classList.remove("d-none");
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
          { role: "user", content: context },
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
  // console.log("Conversation: ", conversation);
  // console.log("Context: ", context);
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
            This is the CONTEXT of all the files: ${context} and 
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
