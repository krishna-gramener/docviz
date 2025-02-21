import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/+esm";
import { Marked } from "https://cdn.jsdelivr.net/npm/marked@13/+esm";
pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs";

// State
let uploadedFiles = [];
let conversation = [];
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

async function extractFileContent(file) {
  if (file.type.includes("pdf")) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument(arrayBuffer).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item) => item.str).join(" ");
    }
    return text;
  } else if (file.type.includes("image")) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
  } else if (file.type.includes("csv") || file.type.includes("excel")) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsText(file);
    });
  }
  throw new Error("Unsupported file type");
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

// Conversation Handling
async function initializeConversation() {
  if (uploadedFiles.length === 0) return;

  loadingModal.show();
  loadingMessage.textContent = "Analyzing files...";

  try {
    const context = uploadedFiles
      .map((file) => {
        return `File: ${file.name}\nContent: ${file.content}\n\n`;
      })
      .join("");

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

  loadingModal.show();
  loadingMessage.textContent = "Getting response...";

  try {
    const response = await fetch("https://llmfoundry.straive.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant. Reference the provided context to answer questions.",
          },
          ...conversation.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
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
  conversation.push({ role, content});
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
}

function exportConversation() {
  const text = conversation
    .map((msg) => `${msg.role}: ${msg.content}`)
    .join("\n\n");

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
