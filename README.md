# DocViz

An enterprise document analytics platform that transforms unstructured documents into actionable insights through advanced natural language processing and intuitive conversational interface.

## Overview

DocViz is a web-based application designed to process, analyze, and extract information from various document formats. It provides a conversational interface for users to interact with their documents, enabling efficient information retrieval and analysis without manual searching.

## Features

- **Multi-format Document Support**
  - PDF documents
  - Word documents (DOCX)
  - Excel spreadsheets (XLSX, XLS)
  - CSV files
  - Images (JPEG, PNG, WebP)
  - Plain text files

- **Document Processing**
  - Automatic text extraction from various file formats
  - Image-to-text conversion using LLM
  - Table data extraction and formatting

- **Conversational Interface**
  - Natural language queries about document content
  - Context-aware responses based on uploaded documents
  - Conversation history tracking and export

- **User Interface**
  - Drag-and-drop file upload
  - Dark/light mode toggle
  - Responsive design for various screen sizes
  - File management with clear all functionality

## Project Structure

- **index.html**: Main application interface with Bootstrap-based responsive design
- **script.js**: Core application logic including:
  - File processing and content extraction
  - LLM integration for document analysis
  - Conversation management
  - UI interactions

## Technical Implementation

### Languages Used

- **HTML5**: Structure and layout
- **CSS3**: Styling (via Bootstrap and custom styles)
- **JavaScript (ES6+)**: Application logic and API interactions

### Libraries and Frameworks

- **Bootstrap 5.3.0**: UI framework for responsive design
- **Bootstrap Icons 1.11.0**: Icon set for UI elements
- **PDF.js (v4)**: PDF document parsing and text extraction
- **Mammoth.js (1.6.0)**: DOCX document parsing
- **XLSX.js (0.18.5)**: Excel and CSV file processing
- **Marked (v13)**: Markdown parsing for formatted responses

### Key Components

#### UI Components
- Drag-and-drop upload zone
- Chat interface with user/assistant message styling
- File list with metadata
- Loading modal for async operations

## Development Notes

- The application uses ES modules for dependency management
- Document context is maintained in memory during the session
- Conversations can be exported for record-keeping
- Error handling is implemented for all file processing operations

## Browser Compatibility

- The application uses modern JavaScript features and requires a contemporary browser
- ES modules are used for imports, requiring browsers with ES6+ support
- PDF.js and other libraries are loaded via CDN

## Security Considerations

- Document processing occurs client-side for privacy
- No permanent storage of document content on servers
