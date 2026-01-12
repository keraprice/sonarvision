# Prompt Synthesizer Feature

## Overview

The **Prompt Synthesizer** is an AI-powered feature that generates the best meta-prompts for Business Analyst phases. Instead of using hard-coded prompts, it dynamically generates optimized prompts based on the specific phase and project inputs.

## Features

- 🤖 **AI-Powered**: Uses Google AI Studio (Gemini) or OpenAI to generate prompts
- 🔄 **Provider Agnostic**: Switch between Google and OpenAI with environment variables
- 📋 **7 BA Phases**: Discovery, Requirements, Wireframing, Stories, Prioritization, Testing, Communication
- 🎯 **Customizable**: Accepts JSON inputs to tailor prompts to specific projects
- 📊 **Structured Output**: Returns system prompts, user prompts, guardrails, examples, and tool suggestions
- 🎨 **Modern UI**: Clean, responsive interface with copy-to-clipboard functionality

## API Endpoint

### POST `/api/prompt-synthesizer`

**Request:**

```json
{
  "phase": "discovery|requirements|wireframing|stories|prioritization|testing|communication",
  "inputs": { "...": "arbitrary JSON" }
}
```

**Response:**

```json
{
  "title": "string",
  "system": "string",
  "user": "string",
  "guardrails": ["string", "..."],
  "few_shots": [{ "input": "string", "ideal": "string" }],
  "tools_suggested": [{ "name": "string", "purpose": "string", "schema": {} }],
  "telemetry_tags": ["string"]
}
```

## Setup Instructions

### 1. Environment Configuration

Create a `.env` file in the project root:

```bash
# AI Provider Configuration
AI_PROVIDER=google
GOOGLE_API_KEY=your_google_api_key_here
OPENAI_API_KEY=your_openai_api_key_here

# Server Configuration
FLASK_ENV=development
FLASK_DEBUG=True
```

### 2. Install Dependencies

```bash
# Activate virtual environment
source venv/bin/activate

# Install required packages
pip install google-generativeai pydantic
```

### 3. Get API Keys

**Google AI Studio (Recommended - Free Tier):**

1. Go to [Google AI Studio](https://aistudio.google.com/)
2. Create a new API key
3. Add to `.env` as `GOOGLE_API_KEY`

**OpenAI (Optional):**

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Create an API key
3. Add to `.env` as `OPENAI_API_KEY`

### 4. Start the Server

```bash
# Start the Flask server
python3 transcription_server.py
```

The server will be available at `http://localhost:5000`

## Usage

### Web Interface

1. Navigate to the main dashboard
2. Click on **"Prompt Synthesizer"** card
3. Select a phase from the dropdown
4. Enter project inputs as JSON (optional)
5. Click **"Generate Best Prompt"**
6. Copy the generated system and user prompts

### API Usage

```bash
curl -X POST http://localhost:5000/api/prompt-synthesizer \
  -H "Content-Type: application/json" \
  -d '{
    "phase": "discovery",
    "inputs": {
      "stakeholders": ["PM", "Dev Team"],
      "project_type": "web application",
      "timeline": "3 months"
    }
  }'
```

## Architecture

### Provider Abstraction

The system uses a provider abstraction layer that supports:

- **Google AI Studio (Gemini 1.5 Flash)** - Default, free tier
- **OpenAI (GPT-4o-mini)** - Paid, requires API key

### File Structure

```
├── ai_providers/
│   └── __init__.py          # Provider abstraction layer
├── schemas.py               # JSON schema validation
├── prompt_synthesizer_api.py # Flask API endpoint
├── transcription_server.py  # Main Flask app (updated)
├── index.html              # UI with Prompt Synthesizer screen
├── script.js               # Frontend JavaScript
├── styles.css              # CSS styling
└── requirements.txt        # Python dependencies
```

### Key Components

1. **AI Providers** (`ai_providers/`): Handles Google and OpenAI API calls
2. **Schema Validation** (`schemas.py`): Validates request/response formats
3. **API Endpoint** (`prompt_synthesizer_api.py`): Flask route handler
4. **Frontend** (`index.html`, `script.js`): User interface
5. **Styling** (`styles.css`): Responsive design

## Meta-Prompt Template

The system uses a sophisticated meta-prompt that guides the AI to generate:

- **System Role**: Defines the AI's behavior and expertise
- **User Instructions**: Specific tasks with input binding
- **Guardrails**: Prevents hallucinations and ensures quality
- **Few-Shot Examples**: Demonstrates expected input/output patterns
- **Tool Suggestions**: Recommends relevant BA tools (Jira, Confluence, etc.)
- **Telemetry Tags**: For tracking and analytics

## Phase-Specific Guidance

Each phase has specialized guidance:

- **Discovery**: Missing stakeholders, risks, measurable metrics
- **Requirements**: FR/NFR, business rules, contradiction detection
- **Wireframing**: Layouts, fields, empty states, navigation
- **Stories**: INVEST principles, Jira mapping, Gherkin patterns
- **Prioritization**: T-shirt sizing, dependencies, sequencing strategies
- **Testing**: Positive/negative/edge cases, coverage gaps
- **Communication**: Audience-aware messaging, risk communication

## Error Handling

- **Input Validation**: JSON format and required fields
- **Provider Errors**: API failures with clear messages
- **Schema Validation**: Response format verification
- **User Feedback**: Toast notifications for success/error states

## Testing

Run the test suite to verify functionality:

```bash
python3 test_prompt_synthesizer.py
```

Expected output:

```
🧪 Running Prompt Synthesizer Tests

Testing schema validation...
✅ Valid request creation: PASSED
✅ Invalid phase validation: PASSED
✅ Valid response validation: PASSED

Testing AI provider imports...
✅ AI provider imports: PASSED

Testing API imports...
✅ API imports: PASSED

📊 Test Results: 3/3 tests passed
🎉 All tests passed! Prompt Synthesizer is ready.
```

## Deployment


## Benefits

1. **Dynamic Prompts**: No more hard-coded, static prompts
2. **AI-Optimized**: Leverages latest AI models for prompt engineering
3. **Context-Aware**: Adapts to specific project inputs and requirements
4. **Professional Quality**: Generates production-ready prompts with guardrails
5. **Tool Integration**: Suggests relevant BA tools and workflows
6. **Scalable**: Easy to add new phases or modify existing ones

## Future Enhancements

- **Prompt Templates**: Save and reuse successful prompt patterns
- **A/B Testing**: Compare different prompt variations
- **Analytics**: Track prompt effectiveness and usage patterns
- **Custom Models**: Fine-tune models on BA-specific data
- **Integration**: Connect with existing BA tools and workflows

---

**Ready to use!** The Prompt Synthesizer is now fully integrated into your BA prompt builder application. 🚀


