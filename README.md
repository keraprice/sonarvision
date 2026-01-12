# SonarVision - Business Analysis Intelligence

SonarVision combines the intelligence and precision of a dolphin's sonar with the clarity of big-picture vision. Just as dolphins use sonar to navigate complex environments and detect hidden details, SonarVision empowers business analysts to see the full scope of a project — from early discovery through release — while also pinpointing the smallest requirement.

**From scope to shore, we see it all.**

A web-based application that helps Business Analysts generate tailored prompts for different phases of their projects. Simply fill in the details and get a ready-to-use prompt for ChatGPT, Gemini, or any other AI tool.

## 🐬 Quick Start

### Option 1: Simple Start (Basic Features Only)

1. **Open the application:**

   ```bash
   # Navigate to the project directory
   cd ~/sonarvision

   # Open in your browser
   open index.html
   ```

   Or simply double-click the `index.html` file in your file explorer.

### Option 2: Full Features with Local Transcription

1. **Install prerequisites:**

   ```bash
   # Install ffmpeg (required for video transcription)
   # macOS:
   brew install ffmpeg

   # Ubuntu/Debian:
   sudo apt install ffmpeg
   ```

2. **Start the application with transcription server:**

   ```bash
   # Navigate to the project directory
   cd ~/sonarvision

   # Run the startup script (installs dependencies automatically)
   ./start_servers.sh
   ```

3. **Open your browser to:** http://localhost:8000

   The transcription server will be running on http://localhost:5001

4. **Set up GPT Integration (Optional but Recommended):**

   - Click the "GPT Settings" button in the top-right corner
   - Get an OpenAI API key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
   - Paste your API key and save it
   - Your key is stored locally in your browser for security

5. **Start using the app:**
   - Select a project phase (Discovery, Requirements, Wireframing, etc.)
   - Fill in the form with your project details
   - Generate a tailored prompt
   - Execute with GPT or copy to use with external AI tools

### Option 3: JIRA Analytics Dashboard Integration

SonarVision includes a fully embedded JIRA Analytics Dashboard for real-time project analytics and ticket management.

1. **Start the JIRA Dashboard:**

   ```bash
   # Use the provided startup script (starts both servers)
   ./start_jira_dashboard.sh

   # Or manually (requires two terminals):
   cd /Users/keraprice/source/jira-ba-dashboard-main
   npm install
   npm run server  # Terminal 1: Backend API (port 8000)
   npm run dev     # Terminal 2: Frontend (port 5173)
   ```

2. **Access the Embedded Dashboard:**

   - Click the "JIRA Analytics" tile in SonarVision
   - The dashboard loads directly within SonarVision
   - Use the refresh and fullscreen controls as needed
   - If the dashboard isn't running, helpful setup instructions are provided

3. **Dashboard Features:**
   - **Embedded Experience:** Full dashboard functionality within SonarVision
   - **Real-time Analytics:** Interactive charts and visualizations
   - **Secure API Integration:** Enterprise-grade security with authentication
   - **Bulk Operations:** CSV import/export and bulk ticket creation
   - **Responsive Design:** Works on desktop, tablet, and mobile
   - **Professional UI:** Modern interface built with React and TypeScript

## 📋 Available Phases

### 1. Discovery Phase

- **Purpose:** Project planning and initial scope definition
- **Inputs:** Team size, roles, feature size, description, stakeholders
- **Output:** Comprehensive project plan with milestones, meetings, and timeline

### 2. Requirements Phase

- **Purpose:** Functional and non-functional requirements gathering, meeting management
- **Inputs:** Project name, activity type, and context-specific fields
- **Output:** Tailored prompts for different requirements activities

**Available Activities:**

- **General Requirements Gathering:** Traditional requirements documentation
- **Meeting Agenda Creation:** Create structured meeting agendas with time allocations
- **Meeting Analysis & Documentation:** Document meeting outcomes, decisions, and action items - with optional video transcription
- **Requirements Review & Gap Analysis:** Upload requirements documents and wireframes to identify gaps and missing considerations

### 3. Wireframing Phase

- **Purpose:** UI/UX design and user flow planning
- **Inputs:** Target users, key screens, main flows, design constraints, wireframe type
- **Output:** Wireframing guidance and best practices
### 4. User Stories Phase

- **Purpose:** Creating detailed user stories and acceptance criteria
- **Inputs:** Epic name, user roles, story format preference
- **Output:** User story templates and writing guidance

### 5. Testing Phase

- **Purpose:** Test planning and quality assurance
- **Inputs:** Test scope, types, environments, key scenarios
- **Output:** Comprehensive testing strategy and plan

### 6. Launch Phase

- **Purpose:** Go-live planning and deployment
- **Inputs:** Go-live date, launch scope, training needs, support plan
- **Output:** Launch checklist and communication strategy

### 7. JIRA Analytics Dashboard

- **Purpose:** Real-time analytics, ticket management, and reporting
- **Features:** Interactive charts, bulk ticket operations, CSV import/export
- **Integration:** Embedded directly within SonarVision with seamless JIRA API access

## 🎯 How to Use

### Step 1: Select a Phase

- Click on any phase card from the main screen
- Each phase is designed for different stages of your project

### Step 2: Fill in the Form

- Complete the required fields (marked with \*)
- Optional fields provide additional context for better prompts
- Use the placeholder text as guidance

### Step 3: Generate Your Prompt

- Click "Generate Prompt" or press Ctrl/Cmd + Enter
- Review the generated prompt
- Click "Copy to Clipboard" to copy it

### Step 4: Use with AI Tools

**Option A: Execute with GPT (Recommended)**

- Click "Execute with GPT" to run the prompt directly in the app
- Get instant responses from OpenAI's GPT models
- Copy the response to use in your project

**Option B: External AI Tools**

- Click "Copy to Clipboard" to copy the prompt
- Paste into ChatGPT, Gemini, Claude, or any AI tool
- Get tailored guidance for your specific project phase

## ⌨️ Keyboard Shortcuts

- **Ctrl/Cmd + Enter:** Generate prompt (when on form screen)
- **Escape:** Go back to previous screen

## 🎨 Features

- **Responsive Design:** Works on desktop, tablet, and mobile
- **Modern UI:** Clean, professional interface with smooth animations
- **Theme Toggle:** Light/Dark modes with header shortcut and persistent preference
- **Dynamic Forms:** Form fields change based on selected phase
- **GPT Integration:** Execute prompts directly with OpenAI's GPT models
- **Video Transcription:** Free local transcription of MP4, MOV, AVI, MKV, and WEBM video files (no API costs!)
- **Copy to Clipboard:** One-click prompt and response copying
- **Toast Notifications:** Feedback for user actions
- **Form Validation:** Ensures all required fields are completed
- **Local Storage:** API keys stored securely in your browser

## 🔧 Technical Details

- **Pure HTML/CSS/JavaScript:** No frameworks or build process required
- **OpenAI API Integration:** Direct connection to GPT models
- **Local Storage:** API keys stored securely in your browser
- **Cross-Platform:** Works on any modern browser
- **Offline Capable:** Basic functionality works without internet (GPT features require connection)

## 📁 File Structure

```
sonarvision/
├── index.html              # Main application file
├── styles.css              # Styling and responsive design
├── script.js               # Application logic and functionality
├── transcription_server.py # Local transcription server
├── requirements.txt        # Python dependencies
├── start_servers.sh        # Startup script for full features
├── transcriber/            # Local transcription engine
│   ├── transcriber.py      # Main transcription script
│   ├── transcribe_video.py # Video transcription script
│   └── ...                 # Other transcriber files
└── README.md               # This file
```

## 🚀 Deployment Options

### Local Development

Simply open `index.html` in your browser - no server required!

### Web Hosting

Upload all files to any web hosting service:

- GitHub Pages
- Vercel
- AWS S3
- Any traditional web hosting

### Desktop App (Optional)

Convert to desktop app using Electron:

```bash
npm install -g electron
electron .
```

## 🎥 Video Transcription Feature

The Meeting Recording Analysis activity now includes automatic video transcription capabilities using a local transcription server (no API costs!):

### How to Use Video Transcription

1. **Select Meeting Recording Analysis** from the Requirements phase
2. **Upload your video file** (MP4, MOV, AVI, MKV, WEBM formats supported)
3. **Click "Transcribe Video"** to automatically extract audio and transcribe
4. **Review the transcription** that appears in the text area
5. **Generate your analysis prompt** with the transcription included

### Supported Video Formats

- MP4 (most common)
- MOV (QuickTime)
- AVI (Audio Video Interleave)
- MKV (Matroska)
- WEBM (Web Media)

### File Size Limits

- Maximum file size: 100MB
- Longer videos may take several minutes to process
- Processing time depends on video length and quality
- No API costs - completely free!

### How It Works

1. **Local Processing:** Video files are processed locally on your machine
2. **Audio Extraction:** FFmpeg extracts audio from your video file
3. **Google Speech Recognition:** Audio is transcribed using Google's free Speech Recognition API
4. **Text Processing:** Transcription is returned and displayed in the form
5. **Analysis Ready:** The transcription is automatically included in your analysis prompt

### Privacy & Security

- Video files are processed locally on your machine
- Audio extraction and transcription happen locally
- No video or audio content is sent to external services
- Transcription results are only visible to you
- Uses Google's free Speech Recognition API (no API key required)

## 🎯 Example Workflow

1. **Discovery Phase Example:**

   - Team Size: 6
   - Roles: 1 BA, 2 Developers, 1 QA, 1 Designer, 1 Product Manager
   - Feature Size: Large
   - Description: Customer portal redesign with new payment integration
   - Stakeholders: Marketing team, Customer support, Finance team

2. **Generated Prompt:**

   ```
   I am a Business Analyst working on a new feature/project. Here are the details:

   Team Information:
   - Team size: 6 people
   - Team roles: 1 BA, 2 Developers, 1 QA, 1 Designer, 1 Product Manager
   - Feature size: Large
   - Key stakeholders: Marketing team, Customer support, Finance team

   Feature Description:
   Customer portal redesign with new payment integration

   Please help me create a comprehensive project plan that includes:
   1. Key milestones and deliverables
   2. Recommended meetings and their frequency
   3. Who should be involved at each step
   4. Timeline estimates for each phase
   5. Potential risks and dependencies to consider
   6. Success criteria for the project
   7. Communication plan for stakeholders

   Please provide specific, actionable recommendations that I can use to guide the project planning process.
   ```

3. **Meeting Recording Analysis Example:**

   - Project Name: Customer Portal Redesign
   - Recording Duration: 45 minutes
   - Participants: John Smith (Product Manager), Sarah Johnson (UX Designer), Mike Brown (Developer)
   - Topics: User authentication requirements, Payment flow design, Technical constraints
   - Upload video file and transcribe
   - Focus Areas: Requirements mentioned, Decisions made, Action items

4. **Generated Analysis Prompt:**

   ```
   I need to analyze a meeting recording for the "Customer Portal Redesign" project.

   Recording Information:
   - Duration: 45 minutes
   - Date: March 15, 2024
   - Participants: John Smith (Product Manager), Sarah Johnson (UX Designer), Mike Brown (Developer)
   - Topics discussed: User authentication requirements, Payment flow design, Technical constraints
   - Focus areas: Requirements mentioned, Decisions made, Action items
   - Video file: Uploaded and transcribed
   - Transcription: Provided below

   Here is the meeting transcription to analyze:

   [Transcription text would appear here]

   Please provide a comprehensive analysis based on this transcription, focusing on extracting actionable insights, requirements, and next steps.
   ```

## 🔐 Security & API Costs

### API Key Security

- Your OpenAI API key is stored locally in your browser's localStorage
- The key is never sent to any external servers except OpenAI
- You can clear the key anytime by clearing your browser data

### API Usage Costs

- **GPT-4:** ~$0.03 per 1K input tokens, ~$0.06 per 1K output tokens
- **GPT-3.5-turbo:** ~$0.0015 per 1K input tokens, ~$0.002 per 1K output tokens
- **Video Transcription:** FREE (uses Google Speech Recognition API)
- **Typical BA prompts:** $0.05-$0.20 per response
- **Video transcription:** $0.00 (completely free!)
- You can change the model in the code to reduce costs

### Privacy

- All prompts and responses are sent to OpenAI's servers
- Review OpenAI's privacy policy for data handling details
- Consider using external AI tools for sensitive information

## 🤝 Contributing

This is a prototype, but suggestions for improvements are welcome:

- Additional phases
- Enhanced prompt templates
- New form field types
- UI/UX improvements
- Additional AI model integrations

## 📝 License

This project is open source and available under the MIT License.

---

**Ready to streamline your BA workflow? Open `index.html` and start generating tailored prompts!** 🚀
