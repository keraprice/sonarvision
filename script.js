// Global variables
let currentPhase = "";
let currentActivity = "";
let formData = {};
let transcriptionInProgress = false;
let promptCache = new Map(); // Cache for identical prompts

// Authentication state
let currentUser = null;
let sessionToken = localStorage.getItem("session_token");

// Project state
let projectCache = [];
let activeProjectId = localStorage.getItem("active_project_id");
let featureCache = {};
let activeFeatureId = localStorage.getItem("active_feature_id");
let pendingSuggestions = [];
let pendingUpdatePayload = null;

// Semantic mapping: defines where each form field should live (project vs feature)
// Add new phases/fields here to extend inference without touching core logic.
const FIELD_SEMANTIC_MAP = {
  discovery: {
    teamMembers: { entity: "project", path: "general.teamMembers", label: "Team members", isList: true },
    featureSize: { entity: "feature", path: "general.tShirtSize", label: "Feature size" },
    featureDescription: { entity: "feature", path: "general.description", label: "Feature description" },
    stakeholders: { entity: "project", path: "general.stakeholders", label: "Stakeholders", isList: true },
    "business-objectives": { entity: "project", path: "general.goals", label: "Business objectives" },
    "current-pain-points": { entity: "project", path: "general.issues", label: "Pain points" },
    "success-metrics": { entity: "project", path: "general.goals", label: "Success metrics" },
  },
  stories: {
    epicName: { entity: "feature", path: "general.name", label: "Epic/Feature name" },
    storyDetails: { entity: "feature", path: "general.description", label: "Story context (feature description)" },
    userRoles: { entity: "project", path: "general.roles", label: "User roles", isList: true },
    acceptanceCriteria: { entity: "project", path: "general.acStyle", label: "Acceptance criteria style" },
  },
  requirements: {
    projectName: { entity: "project", path: "general.name", label: "Project name" },
    businessGoals: { entity: "project", path: "general.goals", label: "Business goals" },
    userTypes: { entity: "project", path: "general.roles", label: "User types/roles", isList: true },
    constraints: { entity: "project", path: "general.issues", label: "Constraints / pain points" },
    acceptanceCriteria: { entity: "project", path: "general.acStyle", label: "Acceptance criteria style" },
    meetingObjectives: { entity: "project", path: "general.goals", label: "Meeting objectives / goals" },
    meetingAttendees: { entity: "project", path: "general.teamMembers", label: "Attendees / team members", isList: true },
  },
};

function getFormFieldsRoot() {
  const activeScreen = document.querySelector(".screen.active");
  if (activeScreen) {
    const withinActive = activeScreen.querySelector(
      "#form-fields, #dynamic-form-fields"
    );
    if (withinActive) return withinActive;
  }
  return (
    document.getElementById("form-fields") ||
    document.getElementById("dynamic-form-fields")
  );
}

// Merge static semantic map with any semantic hints found on the rendered form
function buildSemanticMap(phaseKey) {
  const merged = { ...(FIELD_SEMANTIC_MAP[phaseKey] || {}) };
  const formFields = getFormFieldsRoot();
  if (!formFields) return merged;

  const semanticEls = formFields.querySelectorAll("[data-entity][data-path]");
  semanticEls.forEach((el) => {
    const name = el.id || el.name;
    if (!name) return;
    merged[name] = {
      entity: el.dataset.entity,
      path: el.dataset.path,
      label: el.dataset.label || name,
      isList: el.dataset.isList === "true",
    };
  });
  return merged;
}

// Normalize details payload returned from API (stringified JSON or already-object)
function normalizeDetails(details) {
  if (!details) return {};
  if (typeof details === "string") {
    try {
      return JSON.parse(details);
    } catch (e) {
      console.warn("Failed to parse details JSON", e);
      return {};
    }
  }
  return details;
}

// Utility to hide all main screens so only one is visible at a time
function hideAllScreens() {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });
}

function setProjectBarVisible(show) {
  const bar = document.querySelector(".project-bar-simple");
  if (!bar) return;
  bar.style.display = show ? "grid" : "none";
}

// Interactive workflow state
let interactiveWorkflow = {
  isActive: false,
  currentPhase: 0,
  phases: [],
  phaseResults: {},
  currentFormData: {},
  totalPhases: 0,
};

const THEME_STORAGE_KEY = "sonarvision-theme";

const API_ENDPOINTS = {
  prompt: "http://localhost:5001/api/prompt-synthesizer",
  health: "http://localhost:5001/health",
  transcribe: "http://localhost:5001/transcribe",
  auth: "http://localhost:5001/api/auth",
};

function getApiEndpoint(key) {
  const endpoint = API_ENDPOINTS[key];
  if (!endpoint) {
    throw new Error(`Unknown API endpoint: ${key}`);
  }
  return endpoint;
}

// Phase configurations with form fields and prompt templates
const phaseConfigs = {
  discovery: {
    title: "Discovery Phase",
    fields: [
      {
        name: "teamMembers",
        label: "Team Members",
        type: "participant-table",
        required: true,
      },
      {
        name: "featureSize",
        label: "Feature Size (T-shirt)",
        type: "select",
        options: ["Small", "Medium", "Large", "Extra Large"],
        required: true,
      },
      {
        name: "featureDescription",
        label: "Feature Description",
        type: "textarea",
        placeholder: "Describe the feature or project you're working on...",
        required: true,
      },
      {
        name: "stakeholders",
        label: "Key Stakeholders",
        type: "textarea",
        placeholder: "List the main stakeholders involved...",
        required: false,
      },
    ],
    promptTemplate: `I am a Business Analyst working on a new feature/project. Here are the details:

Project Context:
- Team members: {teamMembers}
- Feature size: {featureSize}
- Key stakeholders: {stakeholders}

Feature Description:
{featureDescription}

Please help me create a comprehensive discovery phase analysis that includes:

1. **Key Stakeholders & Roles**
   - List all stakeholders, their roles, and how they interact with the process
   - Include decision makers, end users, and support teams
   - Define responsibilities and accountability

2. **Current Pain Points & Issues**
   - Describe current issues, bottlenecks, inefficiencies, and pain points
   - Identify process gaps and areas for improvement
   - Document user frustrations and workflow problems

3. **Success Metrics & KPIs**
   - How do you measure success? What KPIs are important?
   - Define baseline metrics and target improvements
   - Include both quantitative and qualitative measures

4. **Technology & System Constraints**
   - List current technology limitations and system constraints
   - Identify integration requirements and technical dependencies
   - Document security, compliance, and performance requirements
   - Resource allocation and capacity planning

5. **Risk Assessment & Mitigation**
   - Technical, business, and project risks
   - Risk impact and probability analysis
   - Contingency plans and mitigation strategies

6. **Meeting Structure & Cadence**
   - Regular meeting schedule (daily standups, weekly reviews, etc.)
   - Meeting purposes and expected outcomes
   - Required participants and preparation needs

7. **Success Criteria & Acceptance Criteria**
   - Project success metrics
   - Quality gates and acceptance criteria
   - Definition of Done for each phase

Please provide specific, actionable recommendations with realistic timelines and clear next steps that I can use to guide the project planning process.`,
  },

  requirements: {
    title: "Requirements Phase",
    fields: [
      {
        name: "projectName",
        label: "Project Name (Optional for Meeting Agenda)",
        type: "text",
        placeholder:
          "e.g., Customer Portal Redesign (leave blank for general meetings)",
        required: false,
      },

      {
        name: "businessGoals",
        label: "Business Goals",
        type: "textarea",
        placeholder: "What are the main business objectives?",
        required: false,
      },
      {
        name: "userTypes",
        label: "User Types",
        type: "textarea",
        placeholder: "e.g., End users, Administrators, Managers",
        required: false,
      },
      {
        name: "constraints",
        label: "Constraints & Limitations",
        type: "textarea",
        placeholder: "Budget, timeline, technical constraints...",
        required: false,
      },
      {
        name: "acceptanceCriteria",
        label: "High-level Acceptance Criteria",
        type: "textarea",
        placeholder: "What defines success for this project?",
        required: false,
      },
      {
        name: "filesUploaded",
        label: "Are there any files or documents uploaded?",
        type: "select",
        options: ["Yes", "No"],
        required: true,
      },
      // Meeting Agenda fields
      {
        name: "meetingType",
        label: "Meeting Type",
        type: "select",
        options: [
          "Stakeholder Interview",
          "Requirements Workshop",
          "User Story Mapping",
          "Process Flow Review",
          "Technical Architecture Discussion",
          "UAT Planning",
          "Sprint Planning",
          "Retrospective",
          "Demo/Showcase",
          "Other",
        ],
        required: true,
      },
      {
        name: "meetingDuration",
        label: "Meeting Duration",
        type: "select",
        options: [
          "15 minutes",
          "30 minutes",
          "45 minutes",
          "1 hour",
          "1.5 hours",
          "2 hours",
          "3 hours",
          "Half day (4 hours)",
          "Full day (8 hours)",
        ],
        required: true,
      },

      {
        name: "meetingObjectives",
        label: "Meeting Objectives",
        type: "textarea",
        placeholder:
          "What specific outcomes do you want to achieve in this meeting? (e.g., Define user authentication requirements, Review wireframes, etc.)",
        required: true,
      },
      {
        name: "preMeetingMaterials",
        label: "Pre-meeting Materials",
        type: "textarea",
        placeholder:
          "Documents, diagrams, or information participants should review before the meeting...",
        required: false,
      },
      // Meeting Analysis & Documentation fields (combined activity)
      {
        name: "meetingAttendees",
        label: "Meeting Attendees",
        type: "participant-table",
        required: false,
      },
      {
        name: "meetingTopics",
        label: "Meeting Topics/Agenda",
        type: "textarea",
        placeholder:
          "What topics were discussed in the meeting? (e.g., User authentication requirements, Payment flow design, Technical constraints)",
        required: false,
      },
      {
        name: "keyDecisions",
        label: "Key Decisions Made",
        type: "textarea",
        placeholder: "What decisions were made during the meeting?",
        required: false,
      },
      {
        name: "discussionPoints",
        label: "Main Discussion Points",
        type: "textarea",
        placeholder: "What were the main topics discussed?",
        required: false,
      },
      {
        name: "actionItems",
        label: "Action Items & Assignments",
        type: "textarea",
        placeholder: "What actions need to be taken and by whom?",
        required: false,
      },
      // Optional video transcription fields
      {
        name: "transcriptionText",
        label: "Meeting Transcription (Optional)",
        type: "textarea",
        placeholder:
          "The transcription will appear here after processing your video file, or you can paste an existing transcription...",
        required: false,
      },
      {
        name: "analysisFocus",
        label: "Analysis Focus Areas",
        type: "textarea",
        placeholder:
          "What specific aspects should I focus on in the analysis? (e.g., Requirements mentioned, Decisions made, Action items, Technical discussions)",
        required: false,
      },
      // Requirements Review & Gap Analysis fields
      {
        name: "projectContext",
        label: "Project Context & Background",
        type: "textarea",
        placeholder:
          "Brief description of the project, business objectives, target users, and current state...",
        required: false,
      },
      {
        name: "businessRules",
        label: "Known Business Rules & Constraints",
        type: "textarea",
        placeholder:
          "Any business rules, compliance requirements, technical constraints, or limitations you're aware of...",
        required: false,
      },
      {
        name: "stakeholderConcerns",
        label: "Stakeholder Concerns & Priorities",
        type: "textarea",
        placeholder:
          "Key stakeholder concerns, priorities, or specific areas of focus for this review...",
        required: false,
      },
      {
        name: "reviewFocus",
        label: "Review Focus Areas",
        type: "textarea",
        placeholder:
          "Specific aspects you want me to focus on (e.g., User experience gaps, Technical feasibility, Business logic completeness, Security considerations)",
        required: false,
      },
    ],
    promptTemplate: `{promptType}

{contextDetails}

{activitySpecificPrompt}`,
  },

  wireframing: {
    title: "Wireframing Phase",
    fields: [
      {
        name: "targetUsers",
        label: "Target Users",
        type: "textarea",
        placeholder: "Describe your primary and secondary users...",
        required: true,
      },
      {
        name: "keyScreens",
        label: "Key Screens/Pages",
        type: "textarea",
        placeholder: "e.g., Login, Dashboard, Profile, Settings",
        required: true,
      },
      {
        name: "mainFlows",
        label: "Main User Flows",
        type: "textarea",
        placeholder:
          "e.g., User registration, Order placement, Report generation",
        required: true,
      },
      {
        name: "designConstraints",
        label: "Design Constraints",
        type: "textarea",
        placeholder:
          "Brand guidelines, accessibility requirements, device limitations...",
        required: false,
      },
      {
        name: "wireframeType",
        label: "Wireframe Type",
        type: "select",
        options: [
          "Low-fidelity (sketches)",
          "Mid-fidelity (digital)",
          "High-fidelity (detailed)",
        ],
        required: true,
      },
      {
        name: "designSystem",
        label: "Design System Reference",
        type: "select",
        options: [
          "Material Design",
          "Apple Human Interface Guidelines",
          "Fluent Design (Microsoft)",
          "Ant Design",
          "Chakra UI",
          "Custom/Brand-specific",
          "No specific system",
        ],
        required: false,
      },
      {
        name: "deviceTypes",
        label: "Target Devices",
        type: "select",
        options: [
          "Desktop only",
          "Mobile only",
          "Tablet only",
          "Desktop + Mobile",
          "Desktop + Tablet",
          "Mobile + Tablet",
          "All devices (Responsive)",
        ],
        required: true,
      },
      {
        name: "colorScheme",
        label: "Color Scheme Preference",
        type: "select",
        options: [
          "Light theme",
          "Dark theme",
          "Both light and dark",
          "Brand colors (specify below)",
        ],
        required: false,
      },
      {
        name: "brandColors",
        label: "Brand Colors (if applicable)",
        type: "textarea",
        placeholder:
          "Primary: #2c75ff, Secondary: #ff861e, Accent: #22c55e, etc.",
        required: false,
      },
      {
        name: "wireframeTool",
        label: "Wireframe Tool/Platform",
        type: "select",
        options: [
          "Figma",
          "Balsamiq",
          "Sketch",
          "Adobe XD",
          "Framer",
          "Miro",
          "Lucidchart",
          "Draw.io",
          "Directly in ChatGPT",
          "Directly in Claude",
          "Other AI tool",
          "Export as image",
          "Export as code",
        ],
        required: true,
      },
    ],
    promptTemplate: `Create a comprehensive wireframe design specification for {wireframeTool}. Use this prompt to generate accurate, detailed wireframes and high-fidelity mockups optimized for your chosen tool.

## PROJECT OVERVIEW
**Application Type:** {targetUsers}
**Key Screens:** {keyScreens}
**User Flows:** {mainFlows}
**Design Constraints:** {designConstraints}
**Wireframe Fidelity:** {wireframeType}
**Design System:** {designSystem}
**Target Devices:** {deviceTypes}
**Color Scheme:** {colorScheme}
**Brand Colors:** {brandColors}
**Wireframe Tool:** {wireframeTool}

## WIREFRAME GENERATION INSTRUCTIONS
Generate wireframes and mockups optimized for {wireframeTool} with the following specifications:

### 1. LAYOUT STRUCTURE
- Create a {deviceTypes} layout optimized for {targetUsers}
- Use {designSystem} design principles and components
- Implement {colorScheme} color scheme with {brandColors}
- Ensure responsive design for all specified device types

### 2. SCREEN BREAKDOWN
For each screen in {keyScreens}, create:
- Header/navigation area with clear hierarchy
- Main content area with proper spacing and alignment
- Footer/action areas with appropriate CTAs
- Sidebar/panel areas where relevant
- Mobile-specific adaptations if applicable

### 3. COMPONENT SPECIFICATIONS
- Use {designSystem} component library
- Include form elements, buttons, cards, and navigation components
- Specify hover states, active states, and disabled states
- Add loading states and empty states where appropriate
- Include error messages and validation feedback

### 4. USER FLOW IMPLEMENTATION
- Map out the complete user journey for {mainFlows}
- Create clear navigation paths between screens
- Add breadcrumbs and progress indicators
- Include back/forward navigation and escape routes
- Show user feedback and confirmation states

### 5. VISUAL DESIGN REQUIREMENTS
- Apply {colorScheme} theme consistently
- Use {brandColors} for primary actions and branding
- Implement proper typography hierarchy
- Add appropriate spacing and padding (8px grid system)
- Include subtle shadows and elevation where needed
- Ensure sufficient color contrast for accessibility

### 6. INTERACTION DESIGN
- Specify clickable areas and interactive elements
- Add hover effects and micro-interactions
- Include form validation and error handling
- Show loading states and progress indicators
- Add tooltips and help text where needed

### 7. RESPONSIVE BEHAVIOR
- Design for {deviceTypes} with appropriate breakpoints
- Show how layouts adapt across screen sizes
- Specify mobile-first or desktop-first approach
- Include touch-friendly sizing for mobile devices
- Ensure content remains readable at all sizes

### 8. ACCESSIBILITY FEATURES
- Ensure WCAG 2.1 AA compliance
- Add proper focus states and keyboard navigation
- Include alt text placeholders for images
- Use semantic HTML structure
- Provide sufficient color contrast ratios

## TECHNICAL SPECIFICATIONS
- Use modern CSS Grid and Flexbox layouts
- Implement consistent spacing system (8px base unit)
- Use relative units (rem, em) for scalable typography
- Include CSS custom properties for theming
- Optimize for performance and fast loading

## DELIVERABLES
1. Complete wireframe set for all specified screens
2. High-fidelity mockups with realistic content
3. Component library with all UI elements
4. Style guide with colors, typography, and spacing
5. Responsive layouts for all device types
6. Interactive prototypes showing user flows

## TOOL-SPECIFIC INSTRUCTIONS
**For {wireframeTool}:**
- Format the output appropriately for {wireframeTool}
- Include any specific import instructions or file formats needed
- Provide tool-specific component suggestions and best practices
- Include any platform-specific design guidelines or constraints
- Suggest optimal workflow for implementing the wireframes in {wireframeTool}

Generate clean, professional designs optimized for {wireframeTool} that can be directly implemented for maximum accuracy and usability.`,
  },

  stories: {
    title: "User Stories Phase",
    fields: [
      {
        name: "epicName",
        label: "Epic Name",
        type: "text",
        placeholder: "e.g., User Authentication",
        required: true,
      },
      {
        name: "userRoles",
        label: "User Roles",
        type: "textarea",
        placeholder: "e.g., Customer, Admin, Manager",
        required: true,
      },
      {
        name: "storyFormat",
        label: "Story Format Preference",
        type: "select",
        options: [
          "As a... I want... So that...",
          "Given... When... Then...",
          "User Story + Acceptance Criteria",
        ],
        required: true,
      },
      {
        name: "acceptanceCriteria",
        label: "Acceptance Criteria Style",
        type: "select",
        options: [
          "Simple bullet points",
          "Gherkin format (Given/When/Then)",
          "Detailed scenarios",
        ],
        required: true,
      },
      {
        name: "storyDetails",
        label: "Story Context",
        type: "textarea",
        placeholder:
          "Describe the main functionality or feature you need stories for...",
        required: true,
      },
      {
        name: "storyInput",
        label: "Story Output Type",
        type: "select",
        options: [
          "One story with multiple acceptance criteria",
          "Multiple stories with individual acceptance criteria",
        ],
        required: true,
      },
      {
        name: "wireframesAttached",
        label: "Are there wireframes attached?",
        type: "select",
        options: ["Yes", "No"],
        required: true,
      },
    ],
    promptTemplate: `I am writing user stories for an epic called "{epicName}". Here are the details:

Story Context:
- User roles: {userRoles}
- Story format: {storyFormat}
- Acceptance criteria style: {acceptanceCriteria}
- Story context: {storyDetails}
- Story input type: {storyInput}
- Wireframes attached: {wireframesAttached}

Please create a complete, full user story for my {epicName} epic. The user story should:

1. Follow the {storyFormat} format exactly
2. Include all necessary details based on the story context: {storyDetails}
3. Be written for the appropriate user role(s): {userRoles}
4. Include comprehensive acceptance criteria in the {acceptanceCriteria} style
5. Be ready for development - complete, clear, and actionable
6. Include any relevant technical requirements, design considerations, and business rules
7. Address edge cases and error scenarios where applicable

Provide the complete user story as a single, well-structured output that I can use directly in my project.`,
  },

  testing: {
    title: "Testing Phase",
    fields: [
      {
        name: "testScope",
        label: "Test Scope",
        type: "textarea",
        placeholder: "What features or functionality need testing?",
        required: true,
      },
      {
        name: "testTypes",
        label: "Test Types Needed",
        type: "select",
        options: [
          "Unit Testing",
          "Integration Testing",
          "System Testing",
          "User Acceptance Testing",
          "All of the above",
        ],
        required: true,
      },
      {
        name: "environments",
        label: "Testing Environments",
        type: "textarea",
        placeholder: "e.g., Development, QA, Staging, Production",
        required: true,
      },
      {
        name: "keyScenarios",
        label: "Key Test Scenarios",
        type: "textarea",
        placeholder: "Critical user journeys and edge cases to test...",
        required: true,
      },
      {
        name: "successCriteria",
        label: "Success Criteria",
        type: "textarea",
        placeholder: "What defines successful testing completion?",
        required: false,
      },
    ],
    promptTemplate: `I am planning the testing phase for a project. Here are the details:

Testing Context:
- Test scope: {testScope}
- Test types: {testTypes}
- Testing environments: {environments}
- Key test scenarios: {keyScenarios}
- Success criteria: {successCriteria}

Please help me create a comprehensive testing strategy by providing:

1. **Testing Strategy & Framework**
   - Test strategy document structure
   - Testing pyramid and coverage requirements
   - Quality gates and exit criteria for each phase

2. **Test Planning & Design**
   - Test case design templates and best practices
   - Test scenario development and prioritization
   - Risk-based testing approach and coverage analysis

3. **Test Environment & Infrastructure**
   - Environment setup and configuration requirements
   - Data management and test data strategy
   - Tool selection and automation framework

4. **Test Execution & Management**
   - Test execution schedule and resource allocation
   - Test progress tracking and reporting
   - Defect management and escalation procedures

5. **Quality Assurance & Validation**
   - Code review and static analysis requirements
   - Performance and security testing considerations
   - Accessibility and usability testing guidelines

6. **User Acceptance Testing (UAT)**
   - UAT planning and stakeholder coordination
   - User training and support requirements
   - Acceptance criteria validation and sign-off

7. **Automation & Continuous Testing**
   - Test automation opportunities and ROI analysis
   - CI/CD integration and continuous testing
   - Test maintenance and regression testing strategy

8. **Risk Management & Contingency**
   - Testing risks and mitigation strategies
   - Go/no-go criteria for each test phase
   - Rollback and recovery procedures

9. **Reporting & Communication**
   - Test status reporting and dashboards
   - Stakeholder communication plan
   - Quality metrics and KPIs

10. **Post-Launch & Maintenance**
    - Production monitoring and alerting
    - Post-deployment validation
    - Ongoing quality assurance processes

Please provide specific, actionable guidance with templates, checklists, and examples that will help me create a robust testing plan ensuring high-quality deliverables.`,
  },

  launch: {
    title: "Launch Phase",
    fields: [
      {
        name: "goLiveDate",
        label: "Target Go-Live Date",
        type: "date",
        required: true,
      },
      {
        name: "launchScope",
        label: "Launch Scope",
        type: "textarea",
        placeholder: "What features are included in this launch?",
        required: true,
      },
      {
        name: "userTraining",
        label: "User Training Needs",
        type: "textarea",
        placeholder: "What training do users need?",
        required: true,
      },
      {
        name: "supportPlan",
        label: "Support Plan",
        type: "textarea",
        placeholder: "How will users get support during and after launch?",
        required: true,
      },
      {
        name: "communicationPlan",
        label: "Communication Plan",
        type: "textarea",
        placeholder: "How will you communicate the launch to stakeholders?",
        required: false,
      },
    ],
    promptTemplate: `I am planning the launch of a new feature/project. Here are the details:

Launch Context:
- Target go-live date: {goLiveDate}
- Launch scope: {launchScope}
- User training needs: {userTraining}
- Support plan: {supportPlan}
- Communication plan: {communicationPlan}

Please help me create a comprehensive launch strategy by providing:

1. **Pre-Launch Readiness & Validation**
   - Launch readiness checklist and criteria
   - Final testing and validation procedures
   - Go/no-go decision framework and stakeholders

2. **Launch Day Execution Plan**
   - Detailed launch day timeline and activities
   - Team roles and responsibilities
   - Real-time monitoring and escalation procedures

3. **Risk Management & Contingency**
   - Rollback plan and procedures
   - Risk mitigation strategies
   - Emergency response and communication protocols

4. **User Training & Adoption**
   - Training schedule and delivery methods
   - Training materials and documentation
   - User adoption metrics and success criteria

5. **Support & Operations**
   - Support team structure and escalation procedures
   - Knowledge base and FAQ development
   - Support tools and ticketing system setup

6. **Communication & Change Management**
   - Stakeholder communication strategy
   - Change management plan and resistance mitigation
   - Marketing and promotional activities

7. **Post-Launch Monitoring & Success**
   - Key performance indicators (KPIs) and metrics
   - Monitoring tools and alerting systems
   - Success criteria validation and reporting

8. **Knowledge Transfer & Documentation**
   - Documentation requirements and templates
   - Knowledge transfer sessions and handoffs
   - Process documentation and standard operating procedures

9. **Continuous Improvement & Lessons Learned**
   - Post-launch review and retrospective process
   - Feedback collection and analysis
   - Continuous improvement recommendations

10. **Celebration & Recognition**
    - Team recognition and celebration activities
    - Stakeholder acknowledgment and appreciation
    - Success stories and case study development

Please provide specific, actionable guidance with templates, checklists, and examples that will help me ensure a successful launch and smooth transition to business-as-usual operations.`,
  },

  jiraDashboard: {
    title: "JIRA Analytics Dashboard",
    fields: [
      {
        name: "dashboardAction",
        label: "Dashboard Action",
        type: "select",
        options: [
          "Open Dashboard",
          "View Analytics",
          "Create Tickets",
          "Generate Reports",
        ],
        required: true,
      },
      {
        name: "jiraUrl",
        label: "JIRA Instance URL (Optional)",
        type: "text",
        placeholder: "https://your-company.atlassian.net",
        required: false,
      },
    ],
    promptTemplate: `I want to access the JIRA Analytics Dashboard to {dashboardAction}.

JIRA Instance: {jiraUrl || "Default instance"}

The JIRA Analytics Dashboard provides:
- Real-time analytics and visualizations
- Interactive charts and reporting
- Bulk ticket creation and management
- CSV import/export capabilities
- Authentication and security features

Please help me understand how to effectively use the dashboard for my business analysis needs.`,
  },

  prioritization: {
    title: "Epic Prioritization & Timeline Management",
    fields: [
      {
        name: "projectName",
        label: "Project Name",
        type: "text",
        placeholder: "e.g., Customer Portal Redesign",
        required: true,
      },
      {
        name: "epics",
        label: "Epic(s)",
        type: "epic-table",
        required: true,
      },
      {
        name: "timelineConstraints",
        label: "Timeline Constraints",
        type: "textarea",
        placeholder: "Any hard deadlines, dependencies, or constraints...",
        required: false,
      },
      {
        name: "roadblocks",
        label: "Known Roadblocks",
        type: "textarea",
        placeholder: "List any current roadblocks or blockers...",
        required: false,
      },
      {
        name: "priorityCriteria",
        label: "Priority Criteria",
        type: "select",
        options: [
          "Business Value",
          "Technical Complexity",
          "User Impact",
          "Risk Level",
          "Dependencies",
          "Custom Criteria",
        ],
        required: true,
      },
      {
        name: "autoAdjustment",
        label: "Enable Auto-Timeline Adjustment",
        type: "select",
        options: ["Yes", "No"],
        required: true,
      },
      {
        name: "teamSize",
        label: "Team Size",
        type: "group",
        fields: [
          {
            name: "businessAnalysts",
            label: "Business Analysts",
            type: "number",
            placeholder: "Number of BAs",
            required: true,
            min: 0,
          },
          {
            name: "developers",
            label: "Developers",
            type: "number",
            placeholder: "Number of developers",
            required: true,
            min: 0,
          },
          {
            name: "qualityAssurance",
            label: "QA Engineers",
            type: "number",
            placeholder: "Number of QAs",
            required: true,
            min: 0,
          },
        ],
      },
    ],
    promptTemplate: `I need to prioritize epics for the project "{projectName}" and create a timeline-based roadmap.

Project Context:
- Project: {projectName}
- Epics to prioritize: {epics}
- Timeline constraints: {timelineConstraints}
- Known roadblocks: {roadblocks}
- Priority criteria: {priorityCriteria}
- Auto-timeline adjustment: {autoAdjustment}
- Team capacity: {businessAnalysts} Business Analysts, {developers} Developers, {qualityAssurance} QA Engineers

Please help me create a comprehensive epic prioritization strategy that includes:

1. **Epic Analysis & Scoring**
   - Evaluate each epic based on {priorityCriteria}
   - Score epics using a consistent methodology
   - Identify dependencies and relationships between epics

2. **Timeline Creation & Optimization**
   - Create an initial timeline based on epic priorities and team capacity
   - Factor in {timelineConstraints}
   - Account for {roadblocks} and potential delays
   - Consider team capacity constraints: {businessAnalysts} BAs, {developers} developers, {qualityAssurance} QAs
   - Calculate realistic delivery timelines based on team size and epic complexity
   - Suggest timeline adjustments for optimal delivery given team constraints

3. **Roadblock Detection & Mitigation**
   - Identify potential roadblocks for each epic
   - Create mitigation strategies for known issues
   - Set up early warning systems for timeline risks

4. **Dynamic Timeline Management**
   - {autoAdjustmentText}
   - Progress tracking and milestone monitoring
   - Resource allocation and capacity planning based on team size
   - Optimize epic sequencing to maximize team utilization
   - Risk assessment and contingency planning for resource constraints

5. **Stakeholder Communication**
   - Timeline visualization and reporting
   - Progress updates and status communication
   - Change management for timeline adjustments

Please provide a detailed prioritization framework that can adapt to changing project conditions and automatically adjust timelines based on roadblocks, progress updates, and team capacity constraints. Include specific recommendations for:

- Epic sequencing that maximizes team productivity
- Resource allocation strategies for the available team size
- Timeline adjustments based on team capacity vs. epic complexity
- Risk mitigation for resource bottlenecks
- Recommendations for team scaling if needed`,
  },

  endToEndProcess: {
    title: "Interactive End-to-End Process Analysis",
    isInteractive: true,
    phases: [
      {
        id: "discovery",
        title: "Phase 1: Discovery & Current State Analysis",
        description:
          "Gather initial process information and analyze current state",
        fields: [
          {
            name: "processName",
            label: "Process Name",
            type: "text",
            placeholder:
              "e.g., Customer Onboarding, Order Fulfillment, Employee Onboarding",
            required: true,
          },
          {
            name: "processType",
            label: "Process Type",
            type: "select",
            options: [
              "Customer-Facing",
              "Internal Operations",
              "Support Process",
              "Compliance Process",
              "Financial Process",
              "HR Process",
              "IT Process",
              "Other",
            ],
            required: true,
          },
          {
            name: "businessObjective",
            label: "Business Objective",
            type: "textarea",
            placeholder:
              "What business goal does this process serve? What value does it create?",
            required: true,
          },
          {
            name: "currentProcessFlow",
            label: "Current Process Flow",
            type: "textarea",
            placeholder:
              "Describe the current step-by-step process flow (high-level overview)...",
            required: true,
          },
        ],
        promptTemplate: `I need to conduct a DISCOVERY PHASE analysis for an end-to-end process improvement project. Here are the initial details:

**Process Overview:**
- Process Name: {processName}
- Process Type: {processType}
- Business Objective: {businessObjective}
- Current Process Flow: {currentProcessFlow}

Please provide a comprehensive DISCOVERY PHASE analysis that includes:

## 1. **Current State Assessment**
- Detailed process mapping with all steps and decision points
- Process flow documentation with inputs, outputs, and handoffs
- Current performance metrics and baseline measurements
- Process complexity and maturity assessment

## 2. **Stakeholder Analysis**
- Complete stakeholder identification and mapping
- Stakeholder roles, responsibilities, and influence levels
- Communication patterns and information flow
- Pain points and satisfaction levels by stakeholder group

## 3. **Gap Analysis**
- Process inefficiencies and bottlenecks
- Technology limitations and manual workarounds
- Compliance and risk issues
- Resource utilization and capacity constraints

## 4. **Key Findings & Recommendations**
- Top 3-5 critical issues to address
- Quick wins and low-hanging fruit opportunities
- Areas requiring deeper analysis in future phases
- Preliminary recommendations for improvement

**IMPORTANT: Please structure your response with clear sections for:**
- **Key Stakeholders & Roles** (list all stakeholders, their roles, and how they interact with the process)
- **Current Pain Points & Issues** (describe current issues, bottlenecks, inefficiencies, and pain points)
- **Success Metrics & KPIs** (how to measure success, what KPIs are important)
- **Technology & System Constraints** (current technology limitations, system constraints, integration requirements)

Please provide specific, actionable insights that will inform the next phase of analysis.`,
      },
      {
        id: "analysis",
        title: "Phase 2: Detailed Analysis & Future State Design",
        description: "Deep dive analysis and design optimized future state",
        fields: [
          {
            name: "stakeholders",
            label: "Key Stakeholders & Roles",
            type: "textarea",
            placeholder:
              "List all stakeholders, their roles, and how they interact with the process...",
            required: true,
          },
          {
            name: "currentPainPoints",
            label: "Current Pain Points & Issues",
            type: "textarea",
            placeholder:
              "Describe current issues, bottlenecks, inefficiencies, and pain points...",
            required: true,
          },
          {
            name: "successMetrics",
            label: "Success Metrics & KPIs",
            type: "textarea",
            placeholder: "How do you measure success? What KPIs are important?",
            required: true,
          },
          {
            name: "technologyConstraints",
            label: "Technology & System Constraints",
            type: "textarea",
            placeholder:
              "Describe current systems, technology limitations, and integration requirements...",
            required: false,
          },
        ],
        promptTemplate: `Building on the DISCOVERY PHASE findings, I need a detailed ANALYSIS PHASE for process improvement. Here are the current details:

**Process Context:**
- Key Stakeholders & Roles: {stakeholders}
- Current Pain Points & Issues: {currentPainPoints}
- Success Metrics & KPIs: {successMetrics}
- Technology & System Constraints: {technologyConstraints || "Not specified"}

**Previous Phase Results:**
{previousPhaseResults}

Please provide a comprehensive ANALYSIS PHASE that includes:

## 1. **Implementation Timeline & Schedule**
- Preferred implementation timeline (1-3 months, 3-6 months, 6-12 months, or 12+ months)
- Phased approach with key milestones and deliverables
- Critical path identification and dependencies
- Resource allocation and capacity planning

## 2. **Budget & Resource Constraints**
- Budget limitations and resource availability
- Cost-benefit analysis and ROI projections
- Resource requirements and skill gaps
- Financial constraints and funding considerations

## 3. **Change Readiness Assessment**
- Organizational change readiness and resistance factors
- Stakeholder support levels and engagement strategies
- Training needs and knowledge transfer requirements
- Communication and adoption strategies

## 4. **Risk Assessment & Mitigation**
- Implementation risks and their impact
- Mitigation strategies and contingency plans
- Success factors and critical success metrics
- Monitoring and evaluation framework

Please provide specific, actionable recommendations with clear timelines, budgets, and change management strategies.`,
      },
      {
        id: "implementation",
        title: "Phase 3: Implementation Plan & Change Management",
        description:
          "Create detailed implementation roadmap and change management strategy",
        fields: [
          {
            name: "implementationTimeline",
            label: "Preferred Implementation Timeline",
            type: "select",
            options: [
              "1-3 months (Quick implementation)",
              "3-6 months (Standard implementation)",
              "6-12 months (Comprehensive implementation)",
              "12+ months (Large-scale transformation)",
            ],
            required: true,
          },
          {
            name: "budgetConstraints",
            label: "Budget & Resource Constraints",
            type: "textarea",
            placeholder:
              "Describe budget limitations, resource availability, and any constraints...",
            required: false,
          },
          {
            name: "changeReadiness",
            label: "Change Readiness Assessment",
            type: "textarea",
            placeholder:
              "Describe organizational change readiness, resistance factors, and support levels...",
            required: false,
          },
        ],
        promptTemplate: `Based on the previous ANALYSIS PHASE, I need a comprehensive IMPLEMENTATION PLAN for the process improvement initiative. Here are the implementation details:

**Implementation Context:**
- Preferred Timeline: {implementationTimeline}
- Budget & Resource Constraints: {budgetConstraints}
- Change Readiness Assessment: {changeReadiness}

**Previous Phase Results:**
{previousPhaseResults}

Please provide a comprehensive IMPLEMENTATION PLAN that includes:

## 1. **Implementation Roadmap**
- Detailed project timeline with milestones and dependencies
- Resource allocation and team structure
- Budget breakdown and cost-benefit analysis
- Risk assessment and mitigation strategies

## 2. **Change Management Strategy**
- Stakeholder engagement and communication plan
- Training and support requirements
- Resistance management and adoption strategies
- Success measurement and feedback mechanisms

## 3. **Technical Implementation**
- System and technology deployment plan
- Data migration and integration approach
- Testing and quality assurance strategy
- Go-live and rollback procedures

## 4. **Success Framework**
- Key performance indicators and success metrics
- Monitoring and reporting structure
- Continuous improvement processes
- Long-term sustainability plan

Please provide specific, actionable steps with clear timelines, responsibilities, and success criteria.`,
      },
    ],
  },

  enhancedTooltips: {
    title: "User Guide Builder",
    fields: [
      {
        name: "peteUser",
        label: "Who is the user?",
        type: "textarea",
        placeholder: "Describe the user who will be using this feature...",
        required: true,
      },
      {
        name: "contentDepth",
        label: "Content Depth Level",
        type: "radio-group",
        options: [
          "Quick Reference (basic steps, key points)",
          "Standard Guide (detailed steps with explanations)",
          "Comprehensive Manual (in-depth coverage with context)",
        ],
        required: true,
      },
      {
        name: "formatOptions",
        label: "Preferred Documentation Formats",
        type: "checkbox-group",
        options: [
          "Step-by-step written guide",
          "Video tutorial script",
          "Interactive walkthrough script",
          "Quick reference card",
          "FAQ section",
          "Troubleshooting guide",
          "Visual flowchart/diagram",
        ],
        required: true,
      },
      {
        name: "highlightType",
        label: "Select what should be highlighted",
        type: "checkbox-group",
        options: [
          "Required fields",
          "Dependency between fields",
          "Page navigation tips",
          "Data grid purposes",
        ],
        required: true,
      },
      {
        name: "highlightDescription",
        label: "Describe what to highlight",
        type: "textarea",
        placeholder:
          "Provide additional details about what should be highlighted in the training materials...",
        required: false,
      },
    ],
    promptTemplate: `I am creating comprehensive training materials and user guides for a new feature. Here are the details:

Project Context:
- User: {{peteUser}}
- Content Depth Level: {{contentDepth}}
- Preferred Documentation Formats: {{formatOptions}}
- Highlight Focus: {{highlightType}}
- Additional Details: {{highlightDescription}}

Please help me create a comprehensive user guide that includes:

1. **Content Depth & Structure**
   Based on the selected depth level ({{contentDepth}}), create content that:
   - Matches the appropriate level of detail and explanation
   - Includes the right amount of context and background information
   - Provides clear learning progression for the target user

2. **Multi-Format Documentation**
   Create content for the requested formats ({{formatOptions}}):
   - **Step-by-step written guide**: Clear, numbered instructions with explanations
   - **Video tutorial script**: Screen-by-screen narration with timing cues
   - **Interactive walkthrough script**: Guided tour with user interaction points
   - **Quick reference card**: Condensed key information for experienced users
   - **FAQ section**: Common questions and detailed answers
   - **Troubleshooting guide**: Problem identification and resolution steps
   - **Visual flowchart/diagram**: Process flows and decision trees

3. **Interactive Tooltip Design**
   - Contextual help messages for each field/component
   - Progressive disclosure of information based on user experience level
   - Visual indicators and icons for tooltips
   - Accessibility considerations for screen readers

4. **Content Strategy**
   - Clear, concise language appropriate for the target user and depth level
   - Visual hierarchy and formatting guidelines for each format
   - Consistent terminology and messaging across all materials
   - Multi-modal learning approaches (text, images, videos)

5. **User Experience Considerations**
   - Onboarding flow for new users (if quick reference) or comprehensive training (if comprehensive manual)
   - Advanced features for experienced users
   - Error prevention and validation messages
   - Feedback mechanisms for user learning

Please provide specific recommendations based on the application design (if attached) and the highlighted focus areas: {{highlightType}}.`,
  },
};

// Initialize the application
document.addEventListener("DOMContentLoaded", function () {
  initializeApp();
});

function initializeApp() {
  // Add click event listeners to phase cards
  const phaseCards = document.querySelectorAll(".phase-card");
  phaseCards.forEach((card) => {
    card.addEventListener("click", function () {
      const phase = this.getAttribute("data-phase");
      selectPhase(phase);
    });
  });

  // Add form submit event listener
  const form = document.getElementById("phase-form");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    generatePrompt();
  });

  // Initialize JIRA Analytics card as hidden
  const jiraCard = document.querySelector(
    '.phase-card[data-phase="jiraDashboard"]'
  );
  if (jiraCard) {
    jiraCard.style.display = "none";
  }

  initializeDarkMode();
  initializeOnboardingPhaseLinks();
  initializeToolLinks();
  loadProjects();
}

function initializeDarkMode() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  const prefersDark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = savedTheme ? savedTheme === "dark" : prefersDark;
  applyTheme(isDark, false);
}

function applyTheme(isDark, persist = true) {
  document.body.classList.toggle("theme-dark", isDark);
  document.body.classList.toggle("theme-light", !isDark);

  if (persist) {
    localStorage.setItem(THEME_STORAGE_KEY, isDark ? "dark" : "light");
  }

  syncThemeControls(isDark);
}

function syncThemeControls(isDark) {
  const darkToggle = document.getElementById("dark-mode-toggle");
  if (darkToggle) {
    darkToggle.checked = isDark;
  }

  const headerToggle = document.getElementById("header-theme-toggle");
  if (headerToggle) {
    headerToggle.setAttribute("aria-pressed", String(isDark));
    headerToggle.classList.toggle("theme-toggle-btn--dark", isDark);
    headerToggle.classList.toggle("theme-toggle-btn--light", !isDark);
    headerToggle.innerHTML = isDark
      ? '<i class="fas fa-sun"></i><span>Light Mode</span>'
      : '<i class="fas fa-moon"></i><span>Dark Mode</span>';
  }
}

function toggleDarkMode() {
  const isCurrentlyDark = document.body.classList.contains("theme-dark");
  applyTheme(!isCurrentlyDark);
}

function initializeOnboardingPhaseLinks() {
  const phaseLinks = document.querySelectorAll(
    ".phase-explanation[data-target-phase]"
  );
  phaseLinks.forEach((item) => {
    const target = item.getAttribute("data-target-phase");
    if (!target) return;

    const handler = () => navigateToPhase(target);

    item.addEventListener("click", handler);
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handler();
      }
    });
  });
}

function navigateToPhase(phaseId) {
  showScreen("phase-selection");
  setTimeout(() => focusPhaseCard(phaseId), 100);
}

function focusPhaseCard(phaseId) {
  const card = document.querySelector(`.phase-card[data-phase="${phaseId}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("phase-card--focus");
  setTimeout(() => card.classList.remove("phase-card--focus"), 1800);
}

function initializeToolLinks() {
  const toolCards = document.querySelectorAll(".tool-card[data-tool-url]");
  toolCards.forEach((card) => {
    const url = card.getAttribute("data-tool-url");
    if (!url) return;

    const openLink = () => {
      window.open(url, "_blank", "noopener");
    };

    card.addEventListener("click", openLink);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openLink();
      }
    });
  });
}

function selectPhase(phase) {
  currentPhase = phase;

  console.log("Selecting phase:", phase);
  console.log("Available phases:", Object.keys(phaseConfigs));

  // Special handling for phases that don't need config
  if (phase === "requirements") {
    showRequirementsActivitySelection();
    return;
  } else if (phase === "jiraDashboard") {
    // Special handling for JIRA Dashboard - embed within SonarVision
    showJiraDashboardEmbedded();
    return;
  } else if (phase === "promptSynthesizer") {
    // Show Prompt Synthesizer interface
    showPromptSynthesizer();
    return;
  }

  const config = phaseConfigs[phase];
  console.log("Config found:", config);

  if (!config) {
    showToast(`Phase configuration not found for: ${phase}`, "error");
    return;
  }

  // Special handling for interactive workflows
  if (phase === "endToEndProcess" && config.isInteractive) {
    // Start interactive end-to-end workflow
    startInteractiveWorkflow(config);
  } else {
    // Update form title
    document.getElementById("form-title").textContent = config.title;

    // Generate form fields
    generateFormFields(config.fields);

    // Show the generate prompt button for all phases
    const formActions = document.querySelector(".form-actions");
    if (formActions) {
      formActions.style.display = "block";
    }

    setProjectBarVisible(true);
    // Show form screen
    showScreen("form-screen");
  }
}

function showRequirementsActivitySelection() {
  const formScreen = document.getElementById("form-screen");
  const formFields = document.getElementById("form-fields");

  // Update form title
  document.getElementById("form-title").textContent =
    "Requirements Phase - Select Activity";

  // Create activity selection interface
  formFields.innerHTML = `
    <div class="activity-selection">
      <p class="activity-description">
        Choose the specific requirements activity you want to work on:
      </p>
      
      <div class="activity-options">
        <div class="activity-option" data-activity="General Requirements Gathering">
          <div class="activity-icon">
            <i class="fas fa-list-check"></i>
          </div>
          <div class="activity-content">
            <h4>General Requirements Gathering</h4>
            <p>Traditional requirements documentation including functional, non-functional, and user stories</p>
          </div>
        </div>
        
        <div class="activity-option" data-activity="Meeting Agenda Creation">
          <div class="activity-icon">
            <i class="fas fa-calendar-alt"></i>
          </div>
          <div class="activity-content">
            <h4>Meeting Agenda Creation</h4>
            <p>Create structured meeting agendas with time allocations and participant roles - works for any meeting type, project-specific or general</p>
          </div>
        </div>
        
        <div class="activity-option" data-activity="Meeting Analysis & Documentation">
          <div class="activity-icon">
            <i class="fas fa-clipboard-list"></i>
          </div>
          <div class="activity-content">
            <h4>Meeting Analysis & Documentation</h4>
            <p>Document meeting outcomes, decisions, and action items - with optional video transcription</p>
          </div>
        </div>
        
        <div class="activity-option" data-activity="Requirements Review & Gap Analysis">
          <div class="activity-icon">
            <i class="fas fa-search"></i>
          </div>
          <div class="activity-content">
            <h4>Requirements Review & Gap Analysis</h4>
            <p>Upload requirements documents and wireframes to identify gaps and missing considerations</p>
          </div>
        </div>
      </div>
    </div>
  `;

  // Add click event listeners to activity options
  const activityOptions = formFields.querySelectorAll(".activity-option");
  activityOptions.forEach((option) => {
    option.addEventListener("click", function () {
      const activity = this.getAttribute("data-activity");
      selectRequirementsActivity(activity);
    });
  });

  // Hide the generate prompt button for activity selection
  const formActions = document.querySelector(".form-actions");
  if (formActions) {
    formActions.style.display = "none";
  }

  // Hide project/feature selectors on this selection screen
  setProjectBarVisible(false);
  // Show form screen
  showScreen("form-screen");
}

// Dashboard management functions
function checkDashboardStatus() {
  const dashboardUrl = "http://localhost:5173";
  const statusElement = document.getElementById("dashboard-status");
  const iframe = document.getElementById("jira-dashboard-frame");
  const fallback = document.getElementById("dashboard-fallback");

  fetch(`${dashboardUrl}`, {
    method: "GET",
    headers: {
      "Content-Type": "text/html",
    },
  })
    .then((response) => {
      if (response.ok) {
        // Dashboard is running
        statusElement.innerHTML =
          '<i class="fas fa-check-circle"></i> Dashboard Connected';
        statusElement.className = "dashboard-status connected";
        iframe.style.display = "block";
        fallback.style.display = "none";
      } else {
        throw new Error("Dashboard not accessible");
      }
    })
    .catch((error) => {
      console.error("Dashboard connection error:", error);
      statusElement.innerHTML =
        '<i class="fas fa-times-circle"></i> Dashboard Not Available';
      statusElement.className = "dashboard-status error";
      iframe.style.display = "none";
      fallback.style.display = "block";
    });
}

function dashboardLoaded() {
  const statusElement = document.getElementById("dashboard-status");
  statusElement.innerHTML =
    '<i class="fas fa-check-circle"></i> Dashboard Loaded';
  statusElement.className = "dashboard-status connected";
}

function dashboardError() {
  const statusElement = document.getElementById("dashboard-status");
  statusElement.innerHTML =
    '<i class="fas fa-times-circle"></i> Failed to Load Dashboard';
  statusElement.className = "dashboard-status error";

  const iframe = document.getElementById("jira-dashboard-frame");
  const fallback = document.getElementById("dashboard-fallback");
  iframe.style.display = "none";
  fallback.style.display = "block";
}

function refreshDashboard() {
  const iframe = document.getElementById("jira-dashboard-frame");
  const statusElement = document.getElementById("dashboard-status");

  statusElement.innerHTML =
    '<i class="fas fa-circle-notch fa-spin"></i> Refreshing...';
  statusElement.className = "dashboard-status loading";

  iframe.src = iframe.src;

  setTimeout(checkDashboardStatus, 2000);
}

function openDashboardFullscreen() {
  const iframe = document.getElementById("jira-dashboard-frame");
  if (iframe.requestFullscreen) {
    iframe.requestFullscreen();
  } else if (iframe.webkitRequestFullscreen) {
    iframe.webkitRequestFullscreen();
  } else if (iframe.msRequestFullscreen) {
    iframe.msRequestFullscreen();
  }
}

function startJiraDashboard() {
  showToast("Starting JIRA Dashboard...", "info");

  const message = `
    🚀 Starting JIRA Analytics Dashboard...
    
    Choose your preferred method:
    
    OPTION 1 - Full Development Setup (Recommended):
    1. Open Terminal
    2. Navigate to: cd /Users/keraprice/source/jira-ba-dashboard-main
    3. Run: npm install (if not done already)
    4. Run: npm run server (in one terminal)
    5. Run: npm run dev (in another terminal)
    6. Wait for both servers to start:
       - Backend: http://localhost:3000
       - Frontend: http://localhost:5173/
    7. Return here and click "Refresh Dashboard"
    
    OPTION 2 - Automated Script:
    If you're already in the SonarVision directory:
    Run: ./start_jira_dashboard.sh
    This will start both servers automatically.
    
    OPTION 3 - Node.js Starter:
    Run: node dashboard_starter.js
    This will start both servers sequentially.
    
    Once both servers are running, click "Refresh Dashboard" to load it.
  `;

  alert(message);
}

function executeNodeStarter() {
  showToast("Starting JIRA Dashboard Servers...", "info");

  const message = `
    🚀 JIRA Dashboard Servers
    
    To start both JIRA dashboard servers:
    
    1. Open Terminal
    2. Navigate to: cd /Users/keraprice/source/jira-ba-dashboard-main
    3. Run: npm install (if not done already)
    4. Run: npm run server (starts backend on port 8000)
    5. In another terminal, run: npm run dev (starts frontend on port 5173)
    6. Both servers will start:
       - Backend API: http://localhost:3000
       - Frontend: http://localhost:5173/
    7. Return here and click "Refresh Dashboard"
    
    This is the complete development setup.
  `;

  alert(message);
}

function openDashboardExternal() {
  window.open("http://localhost:5173/", "_blank");
}

function selectRequirementsActivity(activity) {
  // Set the requirements type
  currentPhase = "requirements";

  // Update form title
  document.getElementById(
    "form-title"
  ).textContent = `Requirements Phase - ${activity}`;

  // Generate form fields with the selected activity
  const config = phaseConfigs.requirements;
  generateFormFields(config.fields, activity);

  // Store the selected activity for prompt generation
  currentActivity = activity;

  // Show the generate prompt button for the selected activity
  const formActions = document.querySelector(".form-actions");
  if (formActions) {
    formActions.style.display = "block";
  }
  setProjectBarVisible(true);
}

function generateFormFields(fields, activity = null) {
  const formFieldsContainer = document.getElementById("form-fields");
  formFieldsContainer.innerHTML = "";

  // Filter fields based on activity
  let filteredFields = fields;
  if (activity) {
    filteredFields = getFieldsForActivity(fields, activity);
  }

  filteredFields.forEach((field) => {
    const formGroup = document.createElement("div");
    formGroup.className = "form-group";

    // Add conditional display logic
    if (field.showWhen) {
      formGroup.style.display = "none";
      formGroup.setAttribute("data-show-when", field.showWhen);
      formGroup.setAttribute("data-show-when-value", field.showWhenValue);
    }

    // Handle new conditional field logic for Figma integration
    if (field.conditional) {
      formGroup.style.display = "none";
      formGroup.setAttribute("data-conditional", field.conditional);
      formGroup.setAttribute(
        "data-conditional-values",
        JSON.stringify(field.conditionalValue)
      );
    }

    const label = document.createElement("label");
    label.textContent = field.label;
    if (field.required) {
      label.innerHTML += ' <span style="color: #e53e3e;">*</span>';
    }

    let input;

    switch (field.type) {
      case "text":
      case "number":
      case "password":
      case "url":
        input = document.createElement("input");
        input.type = field.type;
        input.name = field.name;
        if (field.placeholder) input.placeholder = field.placeholder;
        if (field.required) input.required = true;
        break;

      case "date":
        input = document.createElement("input");
        input.type = "date";
        input.name = field.name;
        if (field.required) input.required = true;

        // Set default value to today's date for date inputs
        const today = new Date().toISOString().split("T")[0];
        input.value = today;
        break;

      case "time":
        input = document.createElement("input");
        input.type = "time";
        input.name = field.name;
        if (field.required) input.required = true;
        break;

      case "textarea":
        input = document.createElement("textarea");
        input.name = field.name;
        input.placeholder = field.placeholder;
        if (field.required) input.required = true;
        break;

      case "file":
        input = document.createElement("input");
        input.type = "file";
        input.name = field.name;
        if (field.accept) input.accept = field.accept;
        if (field.required) input.required = true;
        if (field.multiple) input.multiple = true;

        // Add file info display
        const fileInfo = document.createElement("div");
        fileInfo.className = "file-info";
        fileInfo.style.display = "none";
        fileInfo.style.marginTop = "8px";
        fileInfo.style.fontSize = "0.9rem";
        fileInfo.style.color = "#718096";

        // Add transcription button for video files
        if (field.name === "meetingVideo") {
          const transcriptionButton = document.createElement("button");
          transcriptionButton.type = "button";
          transcriptionButton.className = "btn btn-secondary transcription-btn";
          transcriptionButton.innerHTML =
            '<i class="fas fa-microphone"></i> Transcribe Video';
          transcriptionButton.style.marginTop = "10px";
          transcriptionButton.style.display = "none";
          transcriptionButton.onclick = () => transcribeVideo(input.files[0]);

          const transcriptionStatus = document.createElement("div");
          transcriptionStatus.className = "transcription-status";
          transcriptionStatus.style.display = "none";
          transcriptionStatus.style.marginTop = "10px";
          transcriptionStatus.style.padding = "10px";
          transcriptionStatus.style.borderRadius = "8px";
          transcriptionStatus.style.fontSize = "0.9rem";

          input.addEventListener("change", function () {
            if (this.files && this.files[0]) {
              const file = this.files[0];
              fileInfo.textContent = `Selected: ${file.name} (${(
                file.size /
                1024 /
                1024
              ).toFixed(2)} MB)`;
              fileInfo.style.display = "block";

              // Show transcription button for video files
              if (file.type.startsWith("video/")) {
                transcriptionButton.style.display = "inline-flex";
                transcriptionStatus.style.display = "none";
              } else {
                transcriptionButton.style.display = "none";
              }
            } else {
              fileInfo.style.display = "none";
              transcriptionButton.style.display = "none";
              transcriptionStatus.style.display = "none";
            }
          });

          // Store references for later appending
          input.fileInfo = fileInfo;
          input.transcriptionButton = transcriptionButton;
          input.transcriptionStatus = transcriptionStatus;
        } else {
          input.addEventListener("change", function () {
            if (this.files && this.files.length > 0) {
              if (field.multiple) {
                // Handle multiple files
                const fileList = Array.from(this.files)
                  .map(
                    (file) =>
                      `${file.name} (${(file.size / 1024 / 1024).toFixed(
                        2
                      )} MB)`
                  )
                  .join(", ");
                fileInfo.textContent = `Selected: ${this.files.length} file(s) - ${fileList}`;
              } else {
                // Handle single file
                const file = this.files[0];
                fileInfo.textContent = `Selected: ${file.name} (${(
                  file.size /
                  1024 /
                  1024
                ).toFixed(2)} MB)`;
              }
              fileInfo.style.display = "block";
            } else {
              fileInfo.style.display = "none";
            }
          });

          // Store fileInfo reference for later appending
          input.fileInfo = fileInfo;
        }
        break;

      case "select":
        input = document.createElement("select");
        input.name = field.name;
        if (field.required) input.required = true;

        const defaultOption = document.createElement("option");
        defaultOption.value = "";
        defaultOption.textContent = "Select an option...";
        input.appendChild(defaultOption);

        field.options.forEach((option) => {
          const optionElement = document.createElement("option");
          optionElement.value = option;
          optionElement.textContent = option;
          input.appendChild(optionElement);
        });
        break;

      case "participant-table":
        input = createParticipantTable(field.name, field.required);
        break;

      case "epic-table":
        input = createEpicTable(field.name, field.required);
        break;

      case "group":
        input = document.createElement("div");
        input.className = "form-group-container";

        // Create a container for the group fields
        const groupContainer = document.createElement("div");
        groupContainer.className = "group-fields";
        groupContainer.style.display = "grid";
        groupContainer.style.gridTemplateColumns =
          "repeat(auto-fit, minmax(200px, 1fr))";
        groupContainer.style.gap = "15px";
        groupContainer.style.marginTop = "10px";

        // Generate fields for each sub-field in the group
        field.fields.forEach((subField) => {
          const subFormGroup = document.createElement("div");
          subFormGroup.className = "form-group";

          const subLabel = document.createElement("label");
          subLabel.textContent = subField.label;
          if (subField.required) {
            subLabel.innerHTML += ' <span style="color: #e53e3e;">*</span>';
          }

          let subInput;
          switch (subField.type) {
            case "number":
              subInput = document.createElement("input");
              subInput.type = "number";
              subInput.name = subField.name;
              subInput.placeholder = subField.placeholder;
              if (subField.required) subInput.required = true;
              if (subField.min !== undefined) subInput.min = subField.min;
              break;
            case "text":
              subInput = document.createElement("input");
              subInput.type = "text";
              subInput.name = subField.name;
              subInput.placeholder = subField.placeholder;
              if (subField.required) subInput.required = true;
              break;
            default:
              subInput = document.createElement("input");
              subInput.type = "text";
              subInput.name = subField.name;
              subInput.placeholder = subField.placeholder;
              if (subField.required) subInput.required = true;
          }

          subFormGroup.appendChild(subLabel);
          subFormGroup.appendChild(subInput);
          groupContainer.appendChild(subFormGroup);
        });

        input.appendChild(groupContainer);
        break;

      case "checkbox-group":
        input = document.createElement("div");
        input.className = "checkbox-group";

        // Create header with title and select all button
        const header = document.createElement("div");
        header.className = "checkbox-group-header";

        const title = document.createElement("h4");
        title.className = "checkbox-group-title";
        title.textContent = "Select options:";
        header.appendChild(title);

        const selectAllBtn = document.createElement("button");
        selectAllBtn.type = "button";
        selectAllBtn.className = "select-all-btn";
        selectAllBtn.textContent = "Select All";
        selectAllBtn.onclick = () => toggleSelectAll(input, selectAllBtn);
        header.appendChild(selectAllBtn);

        input.appendChild(header);

        // Create checkbox items
        field.options.forEach((option) => {
          const checkboxContainer = document.createElement("div");
          checkboxContainer.className = "checkbox-item";

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.name = field.name;
          checkbox.value = option;
          checkbox.id = `${field.name}_${option
            .replace(/\s+/g, "_")
            .toLowerCase()}`;

          const customCheckbox = document.createElement("span");
          customCheckbox.className = "custom-checkbox";

          const checkboxLabel = document.createElement("label");
          checkboxLabel.htmlFor = checkbox.id;
          checkboxLabel.textContent = option;

          // Make the entire container clickable
          checkboxContainer.addEventListener("click", (e) => {
            if (e.target !== checkbox) {
              checkbox.checked = !checkbox.checked;
              checkbox.dispatchEvent(new Event("change"));
            }
          });

          checkboxContainer.appendChild(checkbox);
          checkboxContainer.appendChild(customCheckbox);
          checkboxContainer.appendChild(checkboxLabel);
          input.appendChild(checkboxContainer);
        });
        break;

      case "radio-group":
        input = document.createElement("div");
        input.className = "radio-group";

        // Create radio items
        field.options.forEach((option) => {
          const radioContainer = document.createElement("div");
          radioContainer.className = "radio-item";

          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = field.name;
          radio.value = option;
          radio.id = `${field.name}_${option
            .replace(/\s+/g, "_")
            .toLowerCase()}`;
          if (field.required) radio.required = true;

          const customRadio = document.createElement("span");
          customRadio.className = "custom-radio";

          const radioLabel = document.createElement("label");
          radioLabel.htmlFor = radio.id;
          radioLabel.textContent = option;

          // Make the entire container clickable
          radioContainer.addEventListener("click", (e) => {
            if (e.target !== radio) {
              radio.checked = true;
              radio.dispatchEvent(new Event("change"));
            }
          });

          radioContainer.appendChild(radio);
          radioContainer.appendChild(customRadio);
          radioContainer.appendChild(radioLabel);
          input.appendChild(radioContainer);
        });
        break;
    }

    // Add change event listener for conditional fields
    if (field.showWhen && input) {
      input.addEventListener("change", updateConditionalFields);
    }

    formGroup.appendChild(label);
    if (input) {
      if (!input.id) input.id = field.name;
      const hidden = input.querySelector
        ? input.querySelector(
            'input[type="hidden"][name="' + field.name + '"]'
          )
        : null;
      if (hidden && !hidden.id) hidden.id = field.name;
      // Attach semantic hints to support dynamic mapping (optional)
      if (field.semantic) {
        input.dataset.entity = field.semantic.entity;
        input.dataset.path = field.semantic.path;
        if (field.semantic.label) input.dataset.label = field.semantic.label;
        if (field.semantic.isList) input.dataset.isList = "true";
      }
      formGroup.appendChild(input);
    }

    // Add file info if it exists (for file inputs)
    if (field.type === "file" && input.fileInfo) {
      formGroup.appendChild(input.fileInfo);

      // Add transcription button and status for video files
      if (input.transcriptionButton) {
        formGroup.appendChild(input.transcriptionButton);
        formGroup.appendChild(input.transcriptionStatus);
      }
    }

    formFieldsContainer.appendChild(formGroup);

    // Add initial row for participant tables
    if (field.type === "participant-table") {
      // Use setTimeout to ensure the DOM is updated
      setTimeout(() => {
        addParticipantRow(field.name);
      }, 0);
    }
  });

  // Initial update of conditional fields
  updateConditionalFields();
}

function showJiraDashboardEmbedded() {
  const formScreen = document.getElementById("form-screen");
  const formFields = document.getElementById("form-fields");

  // Update form title
  document.getElementById("form-title").textContent =
    "JIRA Analytics Dashboard";

  // Create embedded dashboard interface
  formFields.innerHTML = `
    <div class="dashboard-embedded">
      <div class="dashboard-header">
        <div class="dashboard-controls">
          <button class="btn btn-secondary" onclick="refreshDashboard()">
            <i class="fas fa-sync-alt"></i> Refresh Dashboard
          </button>
          <button class="btn btn-secondary" onclick="openDashboardFullscreen()">
            <i class="fas fa-expand"></i> Fullscreen
          </button>
          <button class="btn btn-secondary" onclick="openDashboardExternal()">
            <i class="fas fa-external-link-alt"></i> Open in New Tab
          </button>
        </div>
        <div class="dashboard-status" id="dashboard-status">
          <i class="fas fa-circle-notch fa-spin"></i> Connecting to JIRA Dashboard...
        </div>
      </div>
      
      <div class="dashboard-container">
        <iframe 
          id="jira-dashboard-frame" 
          src="http://localhost:5173/" 
          frameborder="0"
          allowfullscreen
          onload="dashboardLoaded()"
          onerror="dashboardError()"
        ></iframe>
      </div>
      
      <div class="dashboard-fallback" id="dashboard-fallback" style="display: none;">
        <div class="fallback-content">
          <div class="fallback-icon">
            <i class="fas fa-exclamation-triangle"></i>
          </div>
          <h3>Dashboard Not Available</h3>
          <p>The JIRA Analytics Dashboard is not currently running.</p>
          
          <div class="fallback-actions">
            <button class="btn btn-primary" onclick="startJiraDashboard()">
              <i class="fas fa-play"></i> Start Dashboard
            </button>
            <button class="btn btn-secondary" onclick="executeNodeStarter()">
              <i class="fas fa-terminal"></i> Execute Node Starter
            </button>
            <button class="btn btn-secondary" onclick="openDashboardExternal()">
              <i class="fas fa-external-link-alt"></i> Open in New Tab
            </button>
          </div>
          
          <div class="fallback-instructions">
            <h4>Manual Setup:</h4>
            <ol>
              <li>Open a terminal</li>
              <li>Navigate to: <code>/Users/keraprice/source/jira-ba-dashboard</code></li>
              <li>Run: <code>npm install</code> (if not done already)</li>
              <li>Run: <code>npm run server</code> (starts backend on port 8000)</li>
              <li>Open another terminal and run: <code>npm run dev</code> (starts frontend on port 5173)</li>
              <li>Wait for both servers to start</li>
              <li>Refresh this page once both servers are running</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  `;

  // Show form screen
  showScreen("form-screen");

  // Check dashboard status after a short delay
  setTimeout(checkDashboardStatus, 2000);
}

function getFieldsForActivity(fields, activity) {
  const activityFieldMappings = {
    "General Requirements Gathering": [
      "projectName",
      "businessGoals",
      "userTypes",
      "constraints",
      "acceptanceCriteria",
      "filesUploaded",
    ],
    "Meeting Agenda Creation": [
      "projectName",
      "businessGoals",
      "meetingType",
      "meetingDuration",
      "meetingObjectives",
      "meetingAttendees",
    ],
    "Meeting Analysis & Documentation": [
      "projectName",
      "meetingDate",
      "meetingTime",
      "meetingAttendees",
      "meetingTopics",
      "keyDecisions",
      "discussionPoints",
      "actionItems",
      "meetingVideo",
      "transcriptionText",
      "analysisFocus",
    ],
    "Requirements Review & Gap Analysis": [
      "projectName",
      "requirementsDocument",
      "wireframeScreenshots",
      "projectContext",
      "businessRules",
      "stakeholderConcerns",
      "reviewFocus",
    ],
  };

  const allowedFields = activityFieldMappings[activity] || [];
  return fields.filter((field) => allowedFields.includes(field.name));
}

function updateConditionalFields() {
  const formGroups = document.querySelectorAll(".form-group[data-show-when]");

  formGroups.forEach((group) => {
    const showWhenField = group.getAttribute("data-show-when");
    const showWhenValue = group.getAttribute("data-show-when-value");

    const triggerField = document.querySelector(`[name="${showWhenField}"]`);
    const inputField = group.querySelector("input, textarea, select");

    if (triggerField && triggerField.value === showWhenValue) {
      // Show the field and restore original required state
      group.style.display = "block";
      if (inputField && inputField.hasAttribute("data-original-required")) {
        inputField.required =
          inputField.getAttribute("data-original-required") === "true";
      }
    } else {
      // Hide the field and remove required attribute to prevent validation errors
      group.style.display = "none";
      if (inputField) {
        // Store original required state if not already stored
        if (!inputField.hasAttribute("data-original-required")) {
          inputField.setAttribute(
            "data-original-required",
            inputField.required.toString()
          );
        }
        // Remove required attribute for hidden fields
        inputField.required = false;
      }
    }
  });
}

function createParticipantTable(fieldName, required) {
  const container = document.createElement("div");
  container.className = "participant-table-container";

  const table = document.createElement("table");
  table.className = "participant-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Name</th>
        <th>Role</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody id="${fieldName}-tbody">
    </tbody>
  `;

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "btn btn-secondary btn-sm";
  addButton.innerHTML = '<i class="fas fa-plus"></i> Add Participant';
  addButton.onclick = () => addParticipantRow(fieldName);

  const hiddenInput = document.createElement("input");
  hiddenInput.type = "hidden";
  hiddenInput.name = fieldName;
  hiddenInput.id = fieldName;
  hiddenInput.required = required;

  container.appendChild(table);
  container.appendChild(addButton);
  container.appendChild(hiddenInput);

  return container;
}

function addParticipantRow(fieldName) {
  const tbody = document.getElementById(`${fieldName}-tbody`);
  if (!tbody) {
    console.warn(`Tbody with id "${fieldName}-tbody" not found`);
    return null;
  }
  const rowIndex = tbody.children.length;

  const row = document.createElement("tr");
  row.innerHTML = `
    <td>
      <input type="text" 
             class="participant-name" 
             placeholder="Enter name"
             data-row="${rowIndex}">
    </td>
    <td>
      <select class="participant-role" data-row="${rowIndex}">
        <option value="">Select role...</option>
        <option value="Product Manager">Product Manager</option>
        <option value="Business Analyst">Business Analyst</option>
        <option value="UX Designer">UX Designer</option>
        <option value="UI Designer">UI Designer</option>
        <option value="Developer">Developer</option>
        <option value="QA Engineer">QA Engineer</option>
        <option value="Project Manager">Project Manager</option>
        <option value="Stakeholder">Stakeholder</option>
        <option value="Subject Matter Expert">Subject Matter Expert</option>
        <option value="End User">End User</option>
        <option value="Technical Lead">Technical Lead</option>
        <option value="Scrum Master">Scrum Master</option>
        <option value="DevOps Engineer">DevOps Engineer</option>
        <option value="Data Analyst">Data Analyst</option>
        <option value="Security Specialist">Security Specialist</option>
        <option value="Other">Other</option>
      </select>
    </td>
    <td>
      <button type="button" 
              class="btn btn-secondary btn-sm remove-participant" 
              onclick="removeParticipantRow(this, '${fieldName}')"
              ${rowIndex === 0 ? 'style="display: none;"' : ""}>
        <i class="fas fa-trash"></i>
      </button>
    </td>
  `;

  tbody.appendChild(row);

  // Add event listeners to update hidden input
  const nameInput = row.querySelector(".participant-name");
  const roleSelect = row.querySelector(".participant-role");

  nameInput.addEventListener("input", () => updateParticipantData(fieldName));
  roleSelect.addEventListener("change", () => updateParticipantData(fieldName));

  return row;
}

function removeParticipantRow(button, fieldName) {
  const row = button.closest("tr");
  row.remove();
  updateParticipantData(fieldName);

  // Show/hide remove buttons based on row count
  const tbody = document.getElementById(`${fieldName}-tbody`);
  const removeButtons = tbody.querySelectorAll(".remove-participant");
  if (removeButtons.length === 1) {
    removeButtons[0].style.display = "none";
  }
}

function updateParticipantData(fieldName) {
  const tbody = document.getElementById(`${fieldName}-tbody`);
  const hiddenInput = document.querySelector(`input[name="${fieldName}"]`);

  const participants = [];
  const rows = tbody.querySelectorAll("tr");

  rows.forEach((row) => {
    const name = row.querySelector(".participant-name").value.trim();
    const role = row.querySelector(".participant-role").value;

    if (name && role) {
      participants.push(`${name} - ${role}`);
    }
  });

  hiddenInput.value = participants.join("; ");
}

function createEpicTable(fieldName, required) {
  const container = document.createElement("div");
  container.className = "epic-table-container";

  const table = document.createElement("table");
  table.className = "epic-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Epic Name</th>
        <th>T-Shirt Size</th>
        <th>Description</th>
        <th>Additional Info</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody id="${fieldName}-tbody">
    </tbody>
  `;

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "btn btn-secondary btn-sm";
  addButton.innerHTML = '<i class="fas fa-plus"></i> Add Epic';
  addButton.onclick = () => addEpicRow(fieldName);

  const hiddenInput = document.createElement("input");
  hiddenInput.type = "hidden";
  hiddenInput.name = fieldName;
  hiddenInput.value = "";

  container.appendChild(table);
  container.appendChild(addButton);
  container.appendChild(hiddenInput);

  // Add initial row after DOM is ready
  setTimeout(() => {
    addEpicRow(fieldName);
  }, 0);

  return container;
}

function addEpicRow(fieldName) {
  const tbody = document.getElementById(`${fieldName}-tbody`);
  const rowIndex = tbody.children.length;

  const row = document.createElement("tr");
  row.innerHTML = `
    <td>
      <input type="text" 
             class="epic-name" 
             placeholder="Epic name..."
             data-row="${rowIndex}">
    </td>
    <td>
      <select class="epic-size" data-row="${rowIndex}">
        <option value="">Select size...</option>
        <option value="XS">XS</option>
        <option value="S">S</option>
        <option value="M">M</option>
        <option value="L">L</option>
        <option value="XL">XL</option>
        <option value="XXL">XXL</option>
      </select>
    </td>
    <td>
      <textarea class="epic-description" 
                placeholder="Short description..."
                data-row="${rowIndex}"></textarea>
    </td>
    <td>
      <textarea class="epic-additional" 
                placeholder="Additional info..."
                data-row="${rowIndex}"></textarea>
    </td>
    <td>
      <button type="button" 
              class="btn btn-secondary btn-sm remove-epic" 
              onclick="removeEpicRow(this, '${fieldName}')"
              ${rowIndex === 0 ? 'style="display: none;"' : ""}>
        <i class="fas fa-trash"></i>
      </button>
    </td>
  `;

  tbody.appendChild(row);

  // Add event listeners to update hidden input
  const nameInput = row.querySelector(".epic-name");
  const sizeSelect = row.querySelector(".epic-size");
  const descriptionTextarea = row.querySelector(".epic-description");
  const additionalTextarea = row.querySelector(".epic-additional");

  nameInput.addEventListener("input", () => updateEpicData(fieldName));
  sizeSelect.addEventListener("change", () => updateEpicData(fieldName));
  descriptionTextarea.addEventListener("input", () =>
    updateEpicData(fieldName)
  );
  additionalTextarea.addEventListener("input", () => updateEpicData(fieldName));

  return row;
}

function removeEpicRow(button, fieldName) {
  const row = button.closest("tr");
  row.remove();
  updateEpicData(fieldName);
}

function updateEpicData(fieldName) {
  const tbody = document.getElementById(`${fieldName}-tbody`);
  const hiddenInput = document.querySelector(`input[name="${fieldName}"]`);

  const epics = [];
  const rows = tbody.querySelectorAll("tr");

  rows.forEach((row) => {
    const name = row.querySelector(".epic-name").value.trim();
    const size = row.querySelector(".epic-size").value;
    const description = row.querySelector(".epic-description").value.trim();
    const additional = row.querySelector(".epic-additional").value.trim();

    if (name) {
      let epicData = `**${name}**`;
      if (size) epicData += ` (${size})`;
      if (description) epicData += `\n  Description: ${description}`;
      if (additional) epicData += `\n  Additional Info: ${additional}`;
      epics.push(epicData);
    }
  });

  hiddenInput.value = epics.join("\n\n");
}

// Require saving/associating a project before generating
function generatePrompt() {
  runGeneratePrompt();
}

function runGeneratePrompt() {
  console.log("Generating prompt for phase:", currentPhase);
  const config = phaseConfigs[currentPhase];
  if (!config) {
    showToast(`Phase configuration not found for: ${currentPhase}`, "error");
    return;
  }

  // Collect form data
  const form = document.getElementById("phase-form");
  const formDataObj = new FormData(form);

  formData = {};

  // Handle checkbox groups specially
  const checkboxGroups = {};

  for (let [key, value] of formDataObj.entries()) {
    // Check if this is a checkbox group field
    const checkboxInput = form.querySelector(
      `input[name="${key}"][type="checkbox"]`
    );
    if (checkboxInput) {
      if (!checkboxGroups[key]) {
        checkboxGroups[key] = [];
      }
      checkboxGroups[key].push(value);
    } else {
      formData[key] = value;
    }
  }

  // Convert checkbox groups to comma-separated strings
  Object.keys(checkboxGroups).forEach((key) => {
    formData[key] = checkboxGroups[key].join(", ");
  });

  // Validate required fields (only visible ones)
  const visibleRequiredFields = [];

  // Get all form inputs that are currently visible and required
  const allInputs = document.querySelectorAll(
    "#phase-form input, #phase-form textarea, #phase-form select"
  );
  allInputs.forEach((input) => {
    if (
      input.required &&
      input.closest(".form-group").style.display !== "none"
    ) {
      visibleRequiredFields.push({
        name: input.name,
        label: input
          .closest(".form-group")
          .querySelector("label")
          .textContent.replace(" *", "")
          .trim(),
      });
    }
  });

  const missingFields = visibleRequiredFields.filter(
    (field) =>
      !formData[field.name] || formData[field.name].toString().trim() === ""
  );

  if (missingFields.length > 0) {
    showToast(
      `Please fill in all required fields: ${missingFields
        .map((f) => f.label)
        .join(", ")}`,
      "error"
    );
    return;
  }

  // Capture current values for project suggestions (semantic inference)
  const currentValues = collectRawFormValues();
  const proj = projectCache.find(
    (p) => String(p.id) === String(activeProjectId)
  );
  const featList = featureCache[activeProjectId] || [];
  const feat = featList.find((f) => String(f.id) === String(activeFeatureId));
  const derived = deriveProjectUpdates({
    project: proj,
    feature: feat,
    formId: currentPhase,
    formValues: currentValues,
  });
  pendingSuggestions = derived.suggestions || [];
  pendingUpdatePayload = {
    projectUpdates: derived.projectUpdates,
    featureUpdates: derived.featureUpdates,
  };
  updateSuggestionBanner(pendingSuggestions);

  // Persist submission in the background for project/feature history
  savePhaseSubmission(currentPhase, currentValues);

  // Generate prompt based on phase and activity type
  let prompt;

  if (currentPhase === "requirements") {
    prompt = generateRequirementsPrompt(formData);
  } else if (currentPhase === "wireframing") {
    prompt = generateWireframingPrompt(formData);
  } else if (currentPhase === "enhancedTooltips") {
    // Standard prompt generation for enhancedTooltips
    prompt = config.promptTemplate;

    // Replace placeholders
    Object.keys(formData).forEach((key) => {
      const placeholder = `{{${key}}}`;
      const value = formData[key] || "Not specified";
      prompt = prompt.replace(new RegExp(placeholder, "g"), value);
    });
  } else {
    // Generate prompt by replacing placeholders for other phases
    prompt = config.promptTemplate;
    Object.keys(formData).forEach((key) => {
      const placeholder = `{${key}}`;
      let value = formData[key] || "Not specified";

      // Special handling for prioritization phase
      if (currentPhase === "prioritization") {
        if (key === "timelineConstraints" && !formData[key]) {
          value = "None specified";
        } else if (key === "roadblocks" && !formData[key]) {
          value = "None identified";
        } else if (key === "autoAdjustment") {
          // Set the autoAdjustmentText based on the autoAdjustment value
          const autoAdjustmentValue = formData[key] || "No";
          if (autoAdjustmentValue === "Yes") {
            formData["autoAdjustmentText"] =
              "Automated timeline adjustment based on:";
          } else {
            formData["autoAdjustmentText"] =
              "Manual timeline adjustment considerations:";
          }
        } else if (
          key === "businessAnalysts" ||
          key === "developers" ||
          key === "qualityAssurance"
        ) {
          // Handle team size fields - ensure they have default values
          value = formData[key] || "0";
        }
      }

      // Process autoAdjustmentText for prioritization phase after the main loop
      if (currentPhase === "prioritization" && formData["autoAdjustmentText"]) {
        const placeholder = `{autoAdjustmentText}`;
        const value = formData["autoAdjustmentText"];
        prompt = prompt.replace(new RegExp(placeholder, "g"), value);
      }

      // Format participant table data for better readability
      if (key === "teamMembers" && value !== "Not specified") {
        const participants = value.split("; ").filter((p) => p.trim());
        if (participants.length > 0) {
          value = participants.map((p) => `  • ${p}`).join("\n");
        }
      }

      prompt = prompt.replace(new RegExp(placeholder, "g"), value);
    });
  }

  // Display the generated prompt
  let promptContent = prompt;

  // Add warning message for User Guide Builder
  if (currentPhase === "enhancedTooltips") {
    const warningMessage = `⚠️  IMPORTANT: Before using this prompt, please upload any relevant screenshots, wireframes, or images of your application interface to your AI tool. This will help generate more accurate and specific training materials.

${prompt}`;
    promptContent = warningMessage;
  } else if (currentPhase === "requirements") {
    const warningMessage = `⚠️  IMPORTANT: Before using this prompt, please upload any relevant files (requirements documents, wireframes, screenshots, etc.) to your AI tool. This will help generate more accurate and comprehensive analysis.

${prompt}`;
    promptContent = warningMessage;
  }

  const promptField = document.getElementById("generated-prompt");
  promptField.value = promptContent;
  promptField.readOnly = false;
  promptField.disabled = false;
  showScreen("prompt-screen");
}

function generateWireframingPrompt(formData) {
  // Use the standard template replacement for wireframing
  let prompt = phaseConfigs.wireframing.promptTemplate;

  // Replace all placeholders with form data
  Object.keys(formData).forEach((key) => {
    const placeholder = `{${key}}`;
    const value = formData[key] || "Not specified";
    prompt = prompt.replace(new RegExp(placeholder, "g"), value);
  });

  return prompt;
}

function generateRequirementsPrompt(formData) {
  const activityType = currentActivity;
  let promptType, contextDetails, activitySpecificPrompt;

  switch (activityType) {
    case "General Requirements Gathering":
      promptType = `I am working on the requirements phase for a project called "${formData.projectName}".`;
      contextDetails = `Business Context:
- Business goals: ${formData.businessGoals || "Not specified"}
- User types: ${formData.userTypes || "Not specified"}
- Constraints: ${formData.constraints || "Not specified"}
- Acceptance criteria: ${formData.acceptanceCriteria || "Not specified"}
- Files/documents uploaded: ${formData.filesUploaded || "Not specified"}`;

      activitySpecificPrompt = `Please help me develop comprehensive requirements that include:
1. Functional requirements (what the system should do)
2. Non-functional requirements (performance, security, usability)
3. User stories with acceptance criteria
4. Business rules and validation requirements
5. Integration requirements with other systems
6. Data requirements and data flow
7. Reporting and analytics requirements
8. Security and compliance requirements

Please provide a structured approach to gathering and documenting these requirements, including recommended templates and stakeholder involvement.`;
      break;

    case "Meeting Agenda Creation":
      promptType = `I need to create a meeting agenda for a ${formData.meetingType} meeting.`;
      contextDetails = `Meeting Details:
- Meeting type: ${formData.meetingType}
- Duration: ${formData.meetingDuration || "Not specified"}
- Date: ${formData.meetingDate || "Not specified"}
- Time: ${formData.meetingTime || "Not specified"}
- Attendees: ${formData.meetingAttendees || "Not specified"}
- Objectives: ${formData.meetingObjectives || "Not specified"}
- Pre-meeting materials: ${formData.preMeetingMaterials || "Not specified"}
- Project context: ${
        formData.projectName
          ? `"${formData.projectName}" project`
          : "General meeting (not tied to specific project)"
      }`;

      activitySpecificPrompt = `Please help me create a comprehensive meeting agenda that includes:
1. Meeting objectives and expected outcomes
2. Detailed agenda with time allocations
3. Participant roles and responsibilities
4. Discussion questions and prompts
5. Required materials and preparation needed
6. Meeting ground rules and facilitation tips
7. Follow-up actions and next steps
8. Success criteria for the meeting

Please provide a professional, well-structured agenda that will ensure a productive and focused meeting.`;
      break;

    case "Meeting Analysis & Documentation":
      promptType = `I need to analyze a meeting for the "${formData.projectName}" project.`;
      contextDetails = `Meeting Information:
- Date: ${formData.meetingDate || "Not specified"}
- Attendees: ${formData.meetingAttendees || "Not specified"}
- Topics discussed: ${formData.meetingTopics || "Not specified"}
- Key decisions: ${formData.keyDecisions || "Not specified"}
- Discussion points: ${formData.discussionPoints || "Not specified"}
- Action items: ${formData.actionItems || "Not specified"}
- Video file: ${
        formData.meetingVideo ? "Uploaded and transcribed" : "Not provided"
      }
- Transcription: ${
        formData.transcriptionText ? "Provided below" : "Not provided"
      }`;

      activitySpecificPrompt = `Please help me analyze this meeting by providing:

1. **Executive Summary**
   - Key points discussed and main outcomes
   - Overall meeting effectiveness and participation
   - Critical decisions made and their business impact

2. **Detailed Analysis**
   - Requirements identified and their priority levels
   - User stories mentioned and acceptance criteria discussed
   - Technical constraints and architectural decisions
   - Business rules and validation requirements

3. **Action Items & Assignments**
   - Specific tasks with clear assignees and deadlines
   - Follow-up meetings or review sessions needed
   - Dependencies and blocking issues identified

4. **Stakeholder Insights**
   - Concerns raised and how they were addressed
   - Feedback provided and areas of agreement/disagreement
   - Communication preferences and engagement levels

5. **Risk Assessment**
   - Potential risks or issues identified
   - Mitigation strategies discussed
   - Contingency plans mentioned

6. **Next Steps & Recommendations**
   - Immediate actions required
   - Timeline adjustments or milestone updates
   - Resource allocation or capacity planning needs

7. **Documentation & Communication**
   - Key messages for stakeholder communication
   - Updates needed to project documentation
   - Knowledge transfer requirements

${
  formData.transcriptionText
    ? `Here is the meeting transcription to analyze:

${formData.transcriptionText}

Please provide a comprehensive analysis based on this transcription, focusing on extracting actionable insights, requirements, and next steps.`
    : "Please provide guidance on how to effectively analyze meeting recordings and extract actionable insights, including best practices for transcription analysis and requirements extraction."
}`;
      break;

    case "Requirements Review & Gap Analysis":
      promptType = `I need to conduct a comprehensive requirements review and gap analysis for the "${formData.projectName}" project.`;
      contextDetails = `Project Context:
- Project background: ${formData.projectContext || "Not provided"}
- Business rules & constraints: ${formData.businessRules || "Not provided"}
- Stakeholder concerns: ${formData.stakeholderConcerns || "Not provided"}
- Review focus areas: ${formData.reviewFocus || "Not specified"}
- Requirements document: ${
        formData.requirementsDocument ? "Uploaded" : "Not provided"
      }
- Wireframe screenshots: ${
        formData.wireframeScreenshots ? "Uploaded" : "Not provided"
      }`;

      activitySpecificPrompt = `Please conduct a thorough requirements review and gap analysis by examining:

1. **Requirements Completeness**
   - Are all functional requirements clearly defined?
   - Are non-functional requirements (performance, security, usability) addressed?
   - Are business rules and validation requirements comprehensive?
   - Are edge cases and error scenarios considered?

2. **User Experience Analysis**
   - Do the wireframes support the intended user flows?
   - Are there usability gaps or accessibility concerns?
   - Is the user interface intuitive and consistent?
   - Are there missing screens or navigation elements?

3. **Business Logic Validation**
   - Are business rules consistently applied across requirements?
   - Are there logical inconsistencies or contradictions?
   - Are decision points and conditional logic clearly defined?
   - Are data relationships and dependencies properly specified?

4. **Technical Feasibility**
   - Are requirements technically achievable with current constraints?
   - Are integration points and dependencies identified?
   - Are performance and scalability requirements realistic?
   - Are security and compliance requirements addressed?

5. **Stakeholder Alignment**
   - Do requirements align with stated business objectives?
   - Are stakeholder priorities reflected in the requirements?
   - Are there conflicting requirements between stakeholders?
   - Are success criteria and acceptance criteria clear?

6. **Risk Assessment**
   - What are the potential risks in the current requirements?
   - Are there dependencies that could cause delays?
   - Are there assumptions that need validation?
   - What could go wrong and how can we mitigate it?

7. **Gap Analysis**
   - What requirements are missing or incomplete?
   - What additional considerations should be addressed?
   - What questions should be asked to stakeholders?
   - What additional research or analysis is needed?

8. **Recommendations**
   - Specific actions to improve requirements quality
   - Additional stakeholders to involve
   - Areas requiring further clarification
   - Suggested next steps for requirements refinement

Please provide specific, actionable feedback with examples and suggestions for improvement. Focus on identifying gaps that could lead to project issues or scope creep.`;
      break;

    default:
      promptType = "Requirements phase prompt";
      contextDetails = "General requirements gathering";
      activitySpecificPrompt =
        "Please provide guidance on requirements gathering.";
  }

  return `${promptType}

${contextDetails}

${activitySpecificPrompt}`;
}

function copyPrompt() {
  const promptElement = document.getElementById("generated-prompt");

  const promptText = (promptElement.value || "").trim();

  navigator.clipboard
    .writeText(promptText)
    .then(() => {
      showToast("Prompt copied to clipboard!", "success");
    })
    .catch((err) => {
      console.error("Failed to copy: ", err);
      showToast("Failed to copy prompt", "error");
    });
}

// Persist the generated prompt back to the active project/feature for reuse
// Save pasted LLM response back to project/feature for reuse

function showScreen(screenId) {
  // Hide all screens
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });

  // Show the target screen
  document.getElementById(screenId).classList.add("active");

  const onboardingBtn = document.querySelector(".onboarding-btn");
  if (onboardingBtn) {
    onboardingBtn.style.display =
      screenId === "onboarding-screen" ? "none" : "inline-flex";
  }
}

function showOnboarding() {
  showScreen("onboarding-screen");
}

function goBack() {
  // Special handling for requirements phase
  if (currentPhase === "requirements") {
    // Check if we're in the activity selection or the form
    const formFields = document.getElementById("form-fields");
    const activitySelection = formFields.querySelector(".activity-selection");

    if (activitySelection) {
      // We're in activity selection, go back to phase selection
      showScreen("phase-selection");
    } else {
      // We're in the form, go back to activity selection
      showRequirementsActivitySelection();
    }
  } else {
    showScreen("phase-selection");
  }
}

function goToForm() {
  showScreen("form-screen");
}

function startNew() {
  // Reset form data
  formData = {};
  currentPhase = "";

  // Reset form
  document.getElementById("phase-form").reset();

  // Go back to phase selection
  showScreen("phase-selection");
}

function openSettingsDialog() {
  const dialog = document.getElementById("settings-dialog");
  dialog.style.display = "flex";
  dialog.style.animation = "fadeIn 0.3s ease-in-out";
}

function closeSettingsDialog() {
  const dialog = document.getElementById("settings-dialog");
  dialog.style.animation = "fadeOut 0.3s ease-in-out";
  setTimeout(() => {
    dialog.style.display = "none";
  }, 300);
}

function returnToDashboard() {
  // Reset any active states
  currentPhase = "";
  formData = {};

  // Reset form
  const form = document.getElementById("phase-form");
  if (form) {
    form.reset();
  }

  // Show the phase selection screen (dashboard)
  showScreen("phase-selection");
}

function toggleJiraAnalytics() {
  const toggle = document.getElementById("jira-analytics-toggle");
  const jiraCard = document.querySelector(
    '.phase-card[data-phase="jiraDashboard"]'
  );

  if (jiraCard) {
    if (toggle.checked) {
      jiraCard.style.display = "block";
      jiraCard.style.animation = "fadeIn 0.3s ease-in-out";
    } else {
      jiraCard.style.animation = "fadeOut 0.3s ease-in-out";
      setTimeout(() => {
        jiraCard.style.display = "none";
      }, 300);
    }
  }
}

// Close modal when clicking outside of it
document.addEventListener("click", function (event) {
  const dialog = document.getElementById("settings-dialog");
  if (event.target === dialog) {
    closeSettingsDialog();
  }
});

// Close modal with Escape key
document.addEventListener("keydown", function (event) {
  if (event.key === "Escape") {
    const dialog = document.getElementById("settings-dialog");
    if (dialog.style.display === "flex") {
      closeSettingsDialog();
    }
  }
});

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  const toastMessage = document.getElementById("toast-message");

  // Update message and styling
  toastMessage.textContent = message;
  toast.className = `toast ${type}`;

  // Show toast
  toast.classList.add("show");

  // Hide after 3 seconds
  setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

function toggleSelectAll(checkboxGroup, button) {
  const checkboxes = checkboxGroup.querySelectorAll('input[type="checkbox"]');
  const allChecked = Array.from(checkboxes).every(
    (checkbox) => checkbox.checked
  );

  // Toggle all checkboxes
  checkboxes.forEach((checkbox) => {
    checkbox.checked = !allChecked;
  });

  // Update button text
  button.textContent = allChecked ? "Select All" : "Select None";
}

// Interactive Workflow Functions
function startInteractiveWorkflow(config) {
  interactiveWorkflow.isActive = true;
  interactiveWorkflow.currentPhase = 0;
  interactiveWorkflow.phases = config.phases;
  interactiveWorkflow.totalPhases = config.phases.length;
  interactiveWorkflow.phaseResults = {};
  interactiveWorkflow.currentFormData = {};

  showInteractiveWorkflowInterface();
}

function showInteractiveWorkflowInterface() {
  // Hide all screens first
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });

  // Create or update the interactive workflow screen
  let workflowScreen = document.getElementById("interactive-workflow-screen");
  if (!workflowScreen) {
    workflowScreen = document.createElement("div");
    workflowScreen.id = "interactive-workflow-screen";
    workflowScreen.className = "screen";
    document.querySelector(".container").appendChild(workflowScreen);
  }

  // Make sure the workflow screen is active
  workflowScreen.classList.add("active");

  // Make sure the workflow screen is active
  workflowScreen.classList.add("active");

  workflowScreen.innerHTML = `
    <div class="interactive-workflow">
      <div class="workflow-header">
        <div class="workflow-header-top">
          <button class="back-btn" onclick="returnToDashboard()" title="Return to Main Dashboard">
            <i class="fas fa-home"></i> Back to Dashboard
          </button>
          <h2>Interactive End-to-End Process Analysis</h2>
        </div>
        <div class="workflow-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${
              (interactiveWorkflow.currentPhase /
                interactiveWorkflow.totalPhases) *
              100
            }%"></div>
          </div>
          <span class="progress-text">Phase ${
            interactiveWorkflow.currentPhase + 1
          } of ${interactiveWorkflow.totalPhases}</span>
        </div>
      </div>
      
      <div class="workflow-content">
        <div class="workflow-step">
          <h3>${
            interactiveWorkflow.phases[interactiveWorkflow.currentPhase].title
          }</h3>
          <p class="step-description">${
            interactiveWorkflow.phases[interactiveWorkflow.currentPhase]
              .description
          }</p>
          
          <div class="workflow-form" id="workflow-form">
            <!-- Form fields will be generated here -->
          </div>
          
          <div class="workflow-actions">
            <button id="generate-prompt-btn" class="btn btn-primary" onclick="generateWorkflowPrompt()">
              Generate Prompt
            </button>
          </div>
          
          <div class="workflow-paste-section" id="workflow-paste-section" style="display: none;">
            ${
              interactiveWorkflow.currentPhase <
              interactiveWorkflow.totalPhases - 1
                ? `
            <h4>Paste AI Response</h4>
            <p class="paste-description">
              Copy the AI response from your AI tool and paste it below to proceed to the next phase:
            </p>
            <textarea 
              id="workflow-response-input" 
              class="workflow-response-input"
              placeholder="Paste the AI response here..."
              rows="8"
            ></textarea>
            <div class="workflow-actions">
              <button class="btn btn-secondary" onclick="showInteractiveWorkflowInterface()">
                Back to Form
              </button>
              <button class="btn btn-primary" onclick="proceedToNextPhase()">
                Proceed to Next Phase
              </button>
            </div>
            `
                : `
            <h4>Workflow Complete</h4>
            <p class="paste-description">
              You have completed all phases of the End-to-End process. Click below to view your comprehensive results:
            </p>
            <div class="workflow-actions">
              <button class="btn btn-secondary" onclick="showInteractiveWorkflowInterface()">
                Back to Form
              </button>
              <button class="btn btn-success" onclick="completeWorkflow()">
                Complete End-to-End Process
              </button>
            </div>
            `
            }
          </div>
        </div>
      </div>
    </div>
  `;

  // Show the workflow screen
  workflowScreen.classList.add("active");
  generateWorkflowFormFields();
}

function generateWorkflowFormFields() {
  const formContainer = document.getElementById("workflow-form");
  const currentPhaseConfig =
    interactiveWorkflow.phases[interactiveWorkflow.currentPhase];

  let formHTML = "";

  currentPhaseConfig.fields.forEach((field) => {
    const value = interactiveWorkflow.currentFormData[field.name] || "";
    console.log(`Setting field ${field.name} to value:`, value);

    if (field.type === "select") {
      formHTML += `
        <div class="form-group">
          <label for="${field.name}">${field.label}${
        field.required ? " *" : ""
      }</label>
          <select id="${field.name}" name="${field.name}" ${
        field.required ? "required" : ""
      }>
            <option value="">Select ${field.label}</option>
            ${field.options
              .map(
                (option) =>
                  `<option value="${option}" ${
                    value === option ? "selected" : ""
                  }>${option}</option>`
              )
              .join("")}
          </select>
        </div>
      `;
    } else if (field.type === "textarea") {
      formHTML += `
        <div class="form-group">
          <label for="${field.name}">${field.label}${
        field.required ? " *" : ""
      }</label>
          <textarea id="${field.name}" name="${field.name}" placeholder="${
        field.placeholder
      }" ${field.required ? "required" : ""} rows="4">${value}</textarea>
        </div>
      `;
    } else {
      formHTML += `
        <div class="form-group">
          <label for="${field.name}">${field.label}${
        field.required ? " *" : ""
      }</label>
          <input type="${field.type}" id="${field.name}" name="${
        field.name
      }" placeholder="${field.placeholder}" value="${value}" ${
        field.required ? "required" : ""
      }>
        </div>
      `;
    }
  });

  formContainer.innerHTML = formHTML;
}

function generateWorkflowPrompt() {
  const currentPhaseConfig =
    interactiveWorkflow.phases[interactiveWorkflow.currentPhase];
  const formData = {};

  // Collect form data
  currentPhaseConfig.fields.forEach((field) => {
    const element = document.getElementById(field.name);
    if (element) {
      formData[field.name] = element.value;
      console.log(`Collected ${field.name}:`, element.value);
    } else {
      console.log(`Element not found for ${field.name}`);
    }
  });

  // Store current form data
  interactiveWorkflow.currentFormData = formData;
  console.log("Form data collected:", formData);

  // Generate prompt
  let prompt = currentPhaseConfig.promptTemplate;

  // Replace placeholders
  Object.keys(formData).forEach((key) => {
    const value = formData[key] || "Not specified";
    prompt = prompt.replace(new RegExp(`{${key}}`, "g"), value);
  });

  // Add previous phase results if available
  if (interactiveWorkflow.currentPhase > 0) {
    const previousResults = Object.values(
      interactiveWorkflow.phaseResults
    ).join("\n\n");
    prompt = prompt.replace("{previousPhaseResults}", previousResults);
  } else {
    prompt = prompt.replace(
      "{previousPhaseResults}",
      "This is the first phase of the analysis."
    );
  }

  // Store Phase 3 prompt for final results display
  if (interactiveWorkflow.currentPhase === 2) {
    // Phase 3 (index 2)
    interactiveWorkflow.phase3Prompt = prompt;
  }

  // Show the prompt and paste section in the current screen
  showWorkflowPromptInCurrentScreen(prompt);
}

function showWorkflowPromptInCurrentScreen(prompt) {
  console.log("Showing workflow prompt in current screen");

  // Hide the form and show the prompt with paste section
  const formSection = document.getElementById("workflow-form");
  const actionsSection = document.querySelector(".workflow-actions");
  const pasteSection = document.getElementById("workflow-paste-section");

  console.log("Form section found:", !!formSection);
  console.log("Actions section found:", !!actionsSection);
  console.log("Paste section found:", !!pasteSection);

  if (formSection) {
    formSection.style.display = "none";
    console.log("Form section hidden");
  }

  if (actionsSection) {
    actionsSection.style.display = "none";
    console.log("Actions section hidden");
  }

  if (pasteSection) {
    pasteSection.style.display = "block";
    console.log("Paste section shown");
  }

  // Add the prompt preview above the paste section
  const promptPreview = document.createElement("div");
  promptPreview.className = "prompt-preview";
  promptPreview.innerHTML = `
    <h4>Generated Prompt:</h4>
    <div class="prompt-content">${prompt.replace(/\n/g, "<br>")}</div>
    <div class="workflow-actions" style="margin-top: 20px;">
      <button class="btn btn-secondary" onclick="showInteractiveWorkflowInterface()">
        Back to Form
      </button>
      <button class="btn btn-info" onclick="copyPromptToClipboard()">
        Copy Prompt
      </button>
    </div>
  `;

  // Insert the prompt preview before the paste section
  if (pasteSection && pasteSection.parentNode) {
    pasteSection.parentNode.insertBefore(promptPreview, pasteSection);
  }
}

function extractAndPrePopulateNextPhase(response, currentPhaseIndex = null) {
  // Use provided phase index or current phase
  const phaseIndex =
    currentPhaseIndex !== null
      ? currentPhaseIndex
      : interactiveWorkflow.currentPhase;
  const nextPhaseIndex = phaseIndex + 1;

  console.log(
    "Extracting data from phase",
    phaseIndex,
    "to phase",
    nextPhaseIndex
  );

  if (nextPhaseIndex >= interactiveWorkflow.totalPhases) {
    console.log("No next phase to pre-populate");
    return; // No next phase to pre-populate
  }

  const nextPhase = interactiveWorkflow.phases[nextPhaseIndex];
  const extractedData = {};

  console.log("Next phase:", nextPhase.title);

  // Extract information based on the current phase and next phase requirements
  if (phaseIndex === 0) {
    // Discovery phase -> Analysis phase
    // Extract stakeholders information - look for section headers and content
    const stakeholderSection = response.match(
      /(?:stakeholder|role|responsibility|team|user|person|individual|member|decision maker|end user|support team|participant|involve|engage)[^.]*\./gi
    );
    if (stakeholderSection) {
      extractedData.stakeholders = stakeholderSection.join(" ").trim();
    } else {
      // Fallback: look for any mention of people/roles
      const peopleMatch = response.match(
        /(?:people|individuals|users|staff|employees|customers|clients|managers|directors|executives|teams|departments)[^.]*\./gi
      );
      if (peopleMatch) {
        extractedData.stakeholders = peopleMatch.join(" ").trim();
      }
    }

    // Extract pain points - look for section headers and content
    const painPointSection = response.match(
      /(?:pain point|issue|problem|bottleneck|inefficiency|challenge|difficulty|barrier|obstacle|frustration|complaint|gap|weakness|limitation|constraint|blocker|roadblock)[^.]*\./gi
    );
    if (painPointSection) {
      extractedData.currentPainPoints = painPointSection.join(" ").trim();
    } else {
      // Fallback: look for any mention of problems/issues
      const problemMatch = response.match(
        /(?:problems|issues|challenges|difficulties|barriers|obstacles|frustrations|complaints|gaps|weaknesses|limitations|constraints|blockers|roadblocks)[^.]*\./gi
      );
      if (problemMatch) {
        extractedData.currentPainPoints = problemMatch.join(" ").trim();
      }
    }

    // Extract metrics/KPIs - look for section headers and content
    const metricSection = response.match(
      /(?:metric|kpi|measure|performance|baseline|target|goal|objective|success|outcome|result|indicator|measurement|benchmark|standard|criteria|threshold)[^.]*\./gi
    );
    if (metricSection) {
      extractedData.successMetrics = metricSection.join(" ").trim();
    } else {
      // Fallback: look for any mention of measurement/success
      const successMatch = response.match(
        /(?:success|outcome|result|performance|measurement|benchmark|standard|criteria|threshold|target|goal|objective)[^.]*\./gi
      );
      if (successMatch) {
        extractedData.successMetrics = successMatch.join(" ").trim();
      }
    }

    // Extract technology constraints - look for section headers and content
    const techSection = response.match(
      /(?:technology|system|tool|platform|integration|software|hardware|database|api|interface|constraint|limitation|requirement|dependency|compatibility|security|compliance|performance|capacity|resource)[^.]*\./gi
    );
    if (techSection) {
      extractedData.technologyConstraints = techSection.join(" ").trim();
    } else {
      // Fallback: look for any mention of technical aspects
      const technicalMatch = response.match(
        /(?:technical|system|tool|platform|integration|software|hardware|database|api|interface|constraint|limitation|requirement|dependency|compatibility|security|compliance|performance|capacity|resource)[^.]*\./gi
      );
      if (technicalMatch) {
        extractedData.technologyConstraints = technicalMatch.join(" ").trim();
      }
    }
  } else if (phaseIndex === 1) {
    // Analysis phase -> Implementation phase
    // Extract timeline information
    const timelineMatch = response.match(
      /(?:timeline|schedule|duration|phase|month|week)[^.]*\./gi
    );
    if (timelineMatch) {
      extractedData.implementationTimeline = timelineMatch.join(" ").trim();
    }

    // Extract budget/resource information
    const budgetMatch = response.match(
      /(?:budget|cost|resource|investment|expense)[^.]*\./gi
    );
    if (budgetMatch) {
      extractedData.budgetConstraints = budgetMatch.join(" ").trim();
    }

    // Extract change readiness information
    const changeMatch = response.match(
      /(?:change|readiness|resistance|adoption|training)[^.]*\./gi
    );
    if (changeMatch) {
      extractedData.changeReadiness = changeMatch.join(" ").trim();
    }
  }

  // Store extracted data for pre-population
  interactiveWorkflow.currentFormData = {
    ...interactiveWorkflow.currentFormData,
    ...extractedData,
  };

  console.log("Extracted data:", extractedData);
  console.log("Current form data:", interactiveWorkflow.currentFormData);

  // Show feedback about what was extracted
  const extractedFields = Object.keys(extractedData);
  if (extractedFields.length > 0) {
    console.log("Extracted fields:", extractedFields);
    showToast(
      `Extracted ${extractedFields.length} relevant sections for next phase`,
      "success"
    );
  } else {
    console.log("No data extracted from response");
  }
}

function copyToClipboard(text) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      showToast("Prompt copied to clipboard!", "success");
    })
    .catch((err) => {
      console.error("Failed to copy: ", err);
      showToast("Failed to copy prompt", "error");
    });
}

function copyPromptToClipboard() {
  // Get the prompt from the current active workflow screen
  const workflowScreen = document.getElementById("interactive-workflow-screen");
  if (!workflowScreen) {
    showToast("Workflow screen not found", "error");
    return;
  }

  const promptContent = workflowScreen.querySelector(".prompt-content");
  if (promptContent) {
    // Get the HTML content to preserve formatting
    let promptText = promptContent.innerHTML;

    // Convert HTML line breaks to actual line breaks
    promptText = promptText.replace(/<br\s*\/?>/gi, "\n");

    // Convert HTML bold tags to markdown-style bold
    promptText = promptText.replace(/<strong>(.*?)<\/strong>/gi, "**$1**");
    promptText = promptText.replace(/<b>(.*?)<\/b>/gi, "**$1**");

    // Remove other HTML tags but keep the text content
    promptText = promptText.replace(/<[^>]*>/g, "");

    // Clean up extra whitespace
    promptText = promptText.replace(/\n\s*\n/g, "\n\n").trim();

    copyToClipboard(promptText);
  } else {
    showToast("Prompt not found in current phase", "error");
  }
}

function proceedToNextPhase() {
  // Collect the pasted response
  const responseInput = document.getElementById("workflow-response-input");
  if (responseInput && responseInput.value.trim()) {
    // Store the current phase result
    interactiveWorkflow.phaseResults[interactiveWorkflow.currentPhase] =
      responseInput.value.trim();
    console.log(
      "Stored phase result for phase",
      interactiveWorkflow.currentPhase
    );
    console.log("Response length:", responseInput.value.trim().length);
  }

  interactiveWorkflow.currentPhase++;
  console.log("Moving to phase:", interactiveWorkflow.currentPhase);

  if (interactiveWorkflow.currentPhase < interactiveWorkflow.totalPhases) {
    // Pre-populate next phase with information from previous results
    prePopulateNextPhase();
    // Don't call showInteractiveWorkflowInterface() here as it will regenerate the form
    // The form is already generated in prePopulateNextPhase()
  } else {
    completeWorkflow();
  }
}

function prePopulateNextPhase() {
  const previousResults =
    interactiveWorkflow.phaseResults[interactiveWorkflow.currentPhase - 1] ||
    "";

  console.log("Pre-populating phase:", interactiveWorkflow.currentPhase);
  console.log("Previous results available:", !!previousResults);
  console.log("Previous results length:", previousResults.length);

  if (previousResults) {
    // Use the comprehensive extraction logic
    // Pass the previous phase index (currentPhase - 1) for correct extraction
    const previousPhaseIndex = interactiveWorkflow.currentPhase - 1;
    extractAndPrePopulateNextPhase(previousResults, previousPhaseIndex);

    // Show the workflow interface with the extracted data
    showInteractiveWorkflowInterface();
  } else {
    // No previous results, just show the interface
    showInteractiveWorkflowInterface();
  }
}

function completeWorkflow() {
  // Hide all screens first
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });

  // Create or update the interactive workflow screen
  let workflowScreen = document.getElementById("interactive-workflow-screen");
  if (!workflowScreen) {
    workflowScreen = document.createElement("div");
    workflowScreen.id = "interactive-workflow-screen";
    workflowScreen.className = "screen";
    document.querySelector(".container").appendChild(workflowScreen);
  }

  // Make sure the workflow screen is active
  workflowScreen.classList.add("active");

  let resultsHTML = "";
  Object.keys(interactiveWorkflow.phaseResults).forEach((phaseIndex, index) => {
    const phase = interactiveWorkflow.phases[phaseIndex];
    const result = interactiveWorkflow.phaseResults[phaseIndex];

    resultsHTML += `
      <div class="phase-result">
        <h4>${phase.title}</h4>
        <div class="result-content">${result.replace(/\n/g, "<br>")}</div>
      </div>
    `;
  });

  workflowScreen.innerHTML = `
    <div class="interactive-workflow">
      <div class="workflow-header">
        <div class="workflow-header-top">
          <button class="back-btn" onclick="returnToDashboard()" title="Return to Main Dashboard">
            <i class="fas fa-home"></i> Back to Dashboard
          </button>
          <h2>End-to-End Process Analysis Complete!</h2>
        </div>
        <div class="workflow-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: 100%"></div>
          </div>
          <span class="progress-text">All phases completed</span>
        </div>
      </div>
      
             <div class="workflow-content">
               <div class="workflow-complete">
                 <h3>Analysis Complete!</h3>
                 <p class="completion-message">
                   Congratulations! You have successfully completed the full End-to-End process analysis. 
                   All phases have been completed and your comprehensive analysis is ready.
                 </p>
                 
                 <div class="next-steps-section">
                   <h4>Next Steps</h4>
                   <p class="next-steps-description">
                     Leverage your results with a first draft mockup, framework, or plan to begin further ideation.
                   </p>
                   
                   <div class="next-steps-options">
                     <div class="next-step-card">
                       <h5>Create an Interactive Project Dashboard</h5>
                       <button class="btn btn-primary btn-sm" onclick="copyNextStepPrompt('dashboard')">
                         <i class="fas fa-copy"></i> Copy Prompt
                       </button>
                     </div>
                     
                     <div class="next-step-card">
                       <h5>Develop a Detailed Project Charter & Business Case Presentation</h5>
                       <button class="btn btn-primary btn-sm" onclick="copyNextStepPrompt('charter')">
                         <i class="fas fa-copy"></i> Copy Prompt
                       </button>
                     </div>
                     
                     <div class="next-step-card">
                       <h5>Build a Change Management Toolkit</h5>
                       <button class="btn btn-primary btn-sm" onclick="copyNextStepPrompt('toolkit')">
                         <i class="fas fa-copy"></i> Copy Prompt
                       </button>
                     </div>
                   </div>
                 </div>
                 
                 <div class="workflow-actions">
                   <button class="btn btn-primary" onclick="resetWorkflow()">
                     Start New Analysis
                   </button>
                   <button class="btn btn-secondary" onclick="showScreen('phase-selection')">
                     Back to Home
                   </button>
                 </div>
               </div>
             </div>
    </div>
  `;

  // Show the workflow screen
  workflowScreen.classList.add("active");
}

function resetWorkflow() {
  interactiveWorkflow.isActive = false;
  interactiveWorkflow.currentPhase = 0;
  interactiveWorkflow.phaseResults = {};
  interactiveWorkflow.currentFormData = {};

  // Hide all screens first
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });

  // Show the phase selection screen
  const phaseSelection = document.getElementById("phase-selection");
  if (phaseSelection) {
    phaseSelection.classList.add("active");
  }
}

// Video Transcription Functions
async function transcribeVideo(videoFile) {
  if (!videoFile) {
    showToast("Please select a video file first", "error");
    return;
  }

  if (transcriptionInProgress) {
    showToast("Transcription already in progress", "info");
    return;
  }

  // Check file size (local server has a 100MB limit)
  const maxSize = 100 * 1024 * 1024; // 100MB
  if (videoFile.size > maxSize) {
    showToast(
      "Video file is too large. Please use a file smaller than 100MB",
      "error"
    );
    return;
  }

  // Check if it's a supported video format
  const supportedFormats = [
    "video/mp4",
    "video/quicktime",
    "video/x-msvideo",
    "video/x-matroska",
    "video/webm",
  ];
  if (!supportedFormats.includes(videoFile.type)) {
    showToast(
      "Unsupported video format. Please use MP4, MOV, AVI, MKV, or WEBM files",
      "error"
    );
    return;
  }

  // Find the transcription status element
  const transcriptionStatus = document.querySelector(".transcription-status");
  const transcriptionButton = document.querySelector(".transcription-btn");

  // Check if transcription server is available when running locally
  try {
    const healthCheck = await fetch(getApiEndpoint("health"));
    if (!healthCheck.ok) {
      showToast(
        "Transcription server is not running. Please start the server first.",
        "error"
      );
      return;
    }
  } catch (error) {
    showToast(
      "Cannot connect to transcription server. Please ensure the server is running on localhost:5001",
      "error"
    );
    return;
  }

  if (transcriptionStatus && transcriptionButton) {
    transcriptionInProgress = true;
    transcriptionButton.disabled = true;
    transcriptionButton.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i> Transcribing...';
    transcriptionStatus.style.display = "block";
    transcriptionStatus.style.background = "rgba(49, 130, 206, 0.1)";
    transcriptionStatus.style.border = "1px solid rgba(49, 130, 206, 0.3)";
    transcriptionStatus.style.color = "#3182ce";
    transcriptionStatus.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i> Extracting audio and transcribing... This may take 10-30 minutes for longer videos.';

    try {
      // Send video file directly to transcription server
      const transcription = await transcribeAudio(videoFile);

      // Update the transcription text area
      const transcriptionTextArea = document.querySelector(
        'textarea[name="transcriptionText"]'
      );
      if (transcriptionTextArea) {
        transcriptionTextArea.value = transcription;
        transcriptionTextArea.dispatchEvent(new Event("input")); // Trigger change event
      }

      // Show success status
      transcriptionStatus.style.background = "rgba(72, 187, 120, 0.1)";
      transcriptionStatus.style.border = "1px solid rgba(72, 187, 120, 0.3)";
      transcriptionStatus.style.color = "#48bb78";
      transcriptionStatus.innerHTML =
        '<i class="fas fa-check"></i> Transcription completed successfully!';

      showToast("Video transcribed successfully!", "success");
    } catch (error) {
      console.error("Transcription error:", error);

      // Show error status
      transcriptionStatus.style.background = "rgba(229, 62, 62, 0.1)";
      transcriptionStatus.style.border = "1px solid rgba(229, 62, 62, 0.3)";
      transcriptionStatus.style.color = "#e53e3e";

      let errorMessage = error.message;
      if (error.name === "AbortError") {
        errorMessage =
          "Transcription timed out after 30 minutes. Try with a shorter video or check your internet connection.";
      } else if (error.message.includes("Failed to fetch")) {
        errorMessage =
          "Cannot connect to transcription server. Please ensure the server is running.";
      }

      transcriptionStatus.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Transcription failed: ${errorMessage}`;

      showToast(`Transcription failed: ${errorMessage}`, "error");
    } finally {
      transcriptionInProgress = false;
      transcriptionButton.disabled = false;
      transcriptionButton.innerHTML =
        '<i class="fas fa-microphone"></i> Transcribe Video';
    }
  }
}

async function transcribeAudio(audioBlob) {
  try {
    // Use local transcription server
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800000); // 30 minute timeout

    const response = await fetch(getApiEndpoint("transcribe"), {
      method: "POST",
      body: (() => {
        const formData = new FormData();

        // Add the video file
        formData.append("video", audioBlob);

        // Add transcription parameters
        formData.append("noise_reduction", "1"); // Basic noise reduction
        formData.append("language", "en-EN");

        return formData;
      })(),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const rawText = await response.text();
    let result = null;

    if (rawText) {
      try {
        result = JSON.parse(rawText);
      } catch (parseError) {
        console.error("Failed to parse transcription response:", parseError);
      }
    }

    if (!response.ok) {
      const errorMessage =
        (result && (result.error || result.message)) ||
        `HTTP ${response.status}: ${response.statusText}`;
      throw new Error(errorMessage);
    }

    if (!result) {
      throw new Error("Unexpected empty response from transcription service.");
    }

    if (result.success === false) {
      throw new Error(result.error || "Transcription failed");
    }

    return result.transcription;
  } catch (error) {
    console.error("Transcription API error:", error);
    throw new Error(`Transcription failed: ${error.message}`);
  }
}

// Add keyboard shortcuts
document.addEventListener("keydown", function (e) {
  // Ctrl/Cmd + Enter to generate prompt
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    const activeScreen = document.querySelector(".screen.active");
    if (activeScreen.id === "form-screen") {
      generatePrompt();
    }
  }

  // Escape to go back
  if (e.key === "Escape") {
    const activeScreen = document.querySelector(".screen.active");
    if (activeScreen.id === "form-screen") {
      goBack();
    } else if (activeScreen.id === "prompt-screen") {
      goToForm();
    }
  }
});

function copyNextStepPrompt(stepType) {
  let promptText = "";

  switch (stepType) {
    case "dashboard":
      promptText = `Create an Interactive Project Dashboard

Build a real-time executive dashboard that visualizes key implementation metrics and progress. This should include:

• Gantt chart visualization showing the 18-month timeline with dependencies and critical path
• Budget burn rate tracker with phase-by-phase spending against targets  
• Risk heat map displaying current risk scores and mitigation status
• KPI progress meters showing advancement toward Phase 1, 2, and 3 success criteria
• Resource utilization charts tracking team capacity and allocation

Tool Recommendation: Microsoft Power BI, Tableau, or a project management platform like Monday.com with custom dashboards.`;
      break;

    case "charter":
      promptText = `Develop a Detailed Project Charter & Business Case Presentation

Create comprehensive artifacts for executive approval:

• Executive presentation deck (15-20 slides) summarizing discovery findings, ROI projections, and implementation approach
• Detailed project charter document with roles, responsibilities, success criteria, and governance structure
• Risk assessment matrix with specific mitigation strategies and contingency budgets
• Stakeholder impact analysis showing how each department benefits and what changes they'll experience

Deliverable: Professional presentation package ready for C-suite approval with supporting documentation.`;
      break;

    case "toolkit":
      promptText = `Build a Change Management Toolkit

Develop standardized materials for consistent change management execution:

• Communication templates for each phase (email announcements, newsletter formats, FAQ documents)
• Training curriculum design with detailed lesson plans, exercises, and assessment criteria
• Stakeholder engagement playbook with specific tactics for each support level (Champions, Adopters, Skeptics)
• Adoption tracking surveys and feedback collection instruments
• Change champion toolkit with talking points, objection handling, and success story templates

Purpose: Ensure consistent, professional change management execution across all departments.`;
      break;
  }

  navigator.clipboard
    .writeText(promptText)
    .then(() => {
      showToast("Next step prompt copied to clipboard!", "success");
    })
    .catch((err) => {
      console.error("Failed to copy: ", err);
      showToast("Failed to copy prompt", "error");
    });
}

// Prompt Synthesizer Functions
function showPromptSynthesizer() {
  showScreen("prompt-synthesizer-screen");
  // Initialize form fields based on current phase selection
  updateFormFields();
}

// Function to update form fields based on selected phase
function updateFormFields() {
  const phase = document.getElementById("phase-select").value;
  const formFields = document.getElementById("dynamic-form-fields");
  const generateBtn = document.getElementById("generate-prompt-btn");

  // Clear existing fields
  formFields.innerHTML = "";

  if (!phase) {
    // Show message to select a phase first
    formFields.innerHTML = `
          <div class="form-help form-help--empty-state" style="text-align: center; padding: 2rem;">
            <i class="fas fa-arrow-up" style="font-size: 2rem; margin-bottom: 1rem; display: block;"></i>
            <h4>Select a Phase First</h4>
            <p>Choose a Business Analysis phase from the dropdown above to see the relevant input fields.</p>
          </div>
        `;

    // Disable generate button
    if (generateBtn) {
      generateBtn.disabled = true;
      generateBtn.innerHTML = '<i class="fas fa-lock"></i> Select Phase First';
    }
    return;
  }

  // Enable generate button when phase is selected
  if (generateBtn) {
    generateBtn.disabled = false;
    generateBtn.innerHTML = '<i class="fas fa-magic"></i> Generate Best Prompt';
  }

  // Phase-specific fields
  let phaseFields = "";

  switch (phase) {
    case "discovery":
      phaseFields = `
        <div class="form-group">
          <label for="project-name">Project Name:</label>
          <input type="text" id="project-name" class="form-control" placeholder="Enter project name">
        </div>
        
        <div class="form-group">
          <label for="featureDescription">Feature Description:</label>
          <textarea id="featureDescription" class="form-control" placeholder="Describe the feature or project you're working on..."></textarea>
        </div>
        
        <div class="form-group">
          <label for="stakeholders">Key Stakeholders:</label>
          <textarea id="stakeholders" class="form-control" placeholder="List main stakeholders (comma-separated)"></textarea>
        </div>
        
        <div class="form-group">
          <label for="business-objectives">Business Objectives:</label>
          <textarea id="business-objectives" class="form-control" placeholder="What are the main business goals?"></textarea>
        </div>
        
        <div class="form-group">
          <label for="current-pain-points">Current Pain Points:</label>
          <textarea id="current-pain-points" class="form-control" placeholder="What problems are we trying to solve?"></textarea>
        </div>
        
        <div class="form-group">
          <label for="success-metrics">Success Metrics:</label>
          <textarea id="success-metrics" class="form-control" placeholder="How will we measure success?"></textarea>
        </div>
      `;
      break;

    case "requirements":
      phaseFields = `
        <div class="form-group">
          <label for="project-name">Project Name:</label>
          <input type="text" id="project-name" class="form-control" placeholder="Enter project name">
        </div>
        
        <div class="form-group">
          <label for="functional-requirements">Functional Requirements:</label>
          <textarea id="functional-requirements" class="form-control" placeholder="What should the system do?"></textarea>
        </div>
        
        <div class="form-group">
          <label for="non-functional-requirements">Non-Functional Requirements:</label>
          <textarea id="non-functional-requirements" class="form-control" placeholder="Performance, security, usability requirements"></textarea>
        </div>
        
        <div class="form-group">
          <label for="business-rules">Business Rules:</label>
          <textarea id="business-rules" class="form-control" placeholder="What rules must the system follow?"></textarea>
        </div>
        
        <div class="form-group">
          <label for="constraints">Constraints:</label>
          <textarea id="constraints" class="form-control" placeholder="Technical, budget, timeline constraints"></textarea>
        </div>
      `;
      break;

    case "wireframing":
      phaseFields = `
        <div class="form-group">
          <label for="project-name">Project Name:</label>
          <input type="text" id="project-name" class="form-control" placeholder="Enter project name">
        </div>
        
        <div class="form-group">
          <label for="user-personas">User Personas:</label>
          <textarea id="user-personas" class="form-control" placeholder="Who are the target users?"></textarea>
        </div>
        
        <div class="form-group">
          <label for="key-user-flows">Key User Flows:</label>
          <textarea id="key-user-flows" class="form-control" placeholder="What are the main user journeys?"></textarea>
        </div>
        
        <div class="form-group">
          <label for="design-requirements">Design Requirements:</label>
          <textarea id="design-requirements" class="form-control" placeholder="Brand guidelines, accessibility needs, etc."></textarea>
        </div>
        
        <div class="form-group">
          <label for="device-considerations">Device Considerations:</label>
          <select id="device-considerations" class="form-control">
            <option value="">Select devices...</option>
            <option value="desktop only">Desktop Only</option>
            <option value="mobile only">Mobile Only</option>
            <option value="responsive">Responsive (All Devices)</option>
            <option value="progressive web app">Progressive Web App</option>
          </select>
        </div>
      `;
      break;

    case "stories":
      phaseFields = `
        <div class="form-group">
          <label for="project-name">Project Name:</label>
          <input type="text" id="project-name" class="form-control" placeholder="Enter project name">
        </div>
        
        <div class="form-group">
          <label for="user-roles">User Roles:</label>
          <textarea id="user-roles" class="form-control" placeholder="Who are the different types of users?"></textarea>
        </div>
        
        <div class="form-group">
          <label for="story-output-type">Story Output Type:</label>
          <select id="story-output-type" class="form-control">
            <option value="">Select output type...</option>
            <option value="single story with ACs">Single Story with Acceptance Criteria</option>
            <option value="multiple stories">Multiple Stories</option>
          </select>
        </div>
        
        <div class="form-group">
          <label for="wireframes-attached">Are there wireframes attached?</label>
          <select id="wireframes-attached" class="form-control">
            <option value="">Select...</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
        
        <div class="form-group">
          <label for="story-priorities">Story Priorities:</label>
          <textarea id="story-priorities" class="form-control" placeholder="Which stories are most important?"></textarea>
        </div>
      `;
      break;

    case "prioritization":
      phaseFields = `
        <div class="form-group">
          <label for="project-name">Project Name:</label>
          <input type="text" id="project-name" class="form-control" placeholder="Enter project name">
        </div>
        
        <div class="form-group">
          <label for="epics">Epics to Prioritize:</label>
          <textarea id="epics" class="form-control" placeholder="List the epics or features to prioritize"></textarea>
        </div>
        
        <div class="form-group">
          <label for="timeline-constraints">Timeline Constraints:</label>
          <textarea id="timeline-constraints" class="form-control" placeholder="Any specific deadlines or timeline requirements"></textarea>
        </div>
        
        <div class="form-group">
          <label for="roadblocks">Known Roadblocks:</label>
          <textarea id="roadblocks" class="form-control" placeholder="Any known risks or blockers"></textarea>
        </div>
        
        <div class="form-group">
          <label for="priority-criteria">Priority Criteria:</label>
          <textarea id="priority-criteria" class="form-control" placeholder="What factors should drive prioritization?"></textarea>
        </div>
        
        <div class="form-group">
          <label>Team Capacity:</label>
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem;">
            <div>
              <label for="business-analysts">Business Analysts</label>
              <input type="number" id="business-analysts" class="form-control" placeholder="Number of BAs" min="0">
            </div>
            <div>
              <label for="developers">Developers</label>
              <input type="number" id="developers" class="form-control" placeholder="Number of developers" min="0">
            </div>
            <div>
              <label for="quality-assurance">QA Engineers</label>
              <input type="number" id="quality-assurance" class="form-control" placeholder="Number of QAs" min="0">
            </div>
          </div>
        </div>
      `;
      break;

    case "testing":
      phaseFields = `
        <div class="form-group">
          <label for="project-name">Project Name:</label>
          <input type="text" id="project-name" class="form-control" placeholder="Enter project name">
        </div>
        
        <div class="form-group">
          <label for="test-scope">Test Scope:</label>
          <textarea id="test-scope" class="form-control" placeholder="What needs to be tested?"></textarea>
        </div>
        
        <div class="form-group">
          <label for="test-types">Test Types:</label>
          <textarea id="test-types" class="form-control" placeholder="Unit, integration, system, user acceptance testing"></textarea>
        </div>
        
        <div class="form-group">
          <label for="test-environment">Test Environment:</label>
          <textarea id="test-environment" class="form-control" placeholder="Testing environment details"></textarea>
        </div>
        
        <div class="form-group">
          <label for="test-data">Test Data Requirements:</label>
          <textarea id="test-data" class="form-control" placeholder="What test data is needed?"></textarea>
        </div>
      `;
      break;

    case "communication":
      phaseFields = `
        <div class="form-group">
          <label for="project-name">Project Name:</label>
          <input type="text" id="project-name" class="form-control" placeholder="Enter project name">
        </div>
        
        <div class="form-group">
          <label for="audience">Target Audience:</label>
          <textarea id="audience" class="form-control" placeholder="Who needs to be communicated with?"></textarea>
        </div>
        
        <div class="form-group">
          <label for="communication-type">Communication Type:</label>
          <select id="communication-type" class="form-control">
            <option value="">Select type...</option>
            <option value="status update">Status Update</option>
            <option value="decision request">Decision Request</option>
            <option value="risk alert">Risk Alert</option>
            <option value="milestone celebration">Milestone Celebration</option>
            <option value="change announcement">Change Announcement</option>
          </select>
        </div>
        
        <div class="form-group">
          <label for="key-messages">Key Messages:</label>
          <textarea id="key-messages" class="form-control" placeholder="What are the main points to communicate?"></textarea>
        </div>
        
        <div class="form-group">
          <label for="urgency">Urgency Level:</label>
          <select id="urgency" class="form-control">
            <option value="">Select urgency...</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      `;
      break;
  }

  formFields.innerHTML = phaseFields;
}

// Function to construct JSON inputs from form fields
function constructInputsFromForm() {
  const inputs = {};

  // Get all form elements in the dynamic form fields
  const formFields = document.getElementById("dynamic-form-fields");
  const elements = formFields.querySelectorAll("input, textarea, select");

  elements.forEach((element) => {
    if (element.value && element.value.trim() !== "") {
      // Convert field names to camelCase and clean up
      let key = element.id.replace(/-([a-z])/g, (g) => g[1].toUpperCase());

      // Handle special cases
      if (key === "stakeholders" && element.value.includes(",")) {
        // Convert comma-separated stakeholders to array
        inputs[key] = element.value
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s);
      } else if (
        key === "businessAnalysts" ||
        key === "developers" ||
        key === "qualityAssurance"
      ) {
        // Handle team capacity fields - ensure they have default values
        inputs[key] = parseInt(element.value) || 0;
      } else if (element.type === "number") {
        inputs[key] = parseInt(element.value);
      } else {
        inputs[key] = element.value.trim();
      }
    }
  });

  return inputs;
}

async function generateMetaPrompt() {
  const phaseSelect = document.getElementById("phase-select");
  const resultsDiv = document.getElementById("synthesizer-results");
  const errorDiv = document.getElementById("synthesizer-error");

  // Hide previous results
  resultsDiv.style.display = "none";
  errorDiv.style.display = "none";

  // Validate inputs
  if (!phaseSelect.value) {
    showError("Please select a phase");
    return;
  }

  // Automatically construct JSON from form fields
  const inputs = constructInputsFromForm();
  console.log("Sending inputs:", inputs);

  // Show loading state
  const generateBtn = document.querySelector(
    'button[onclick="generateMetaPrompt()"]'
  );
  const originalText = generateBtn.innerHTML;
  generateBtn.innerHTML =
    '<i class="fas fa-spinner fa-spin"></i> Generating...';
  generateBtn.disabled = true;

  try {
    const response = await fetch(getApiEndpoint("prompt"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phase: phaseSelect.value,
        inputs: inputs,
      }),
    });

    if (!response.ok) {
      let errorBody = null;
      try {
        errorBody = await response.json();
      } catch (_ignored) {
        // ignore parse error and rely on status text
      }

      const errorMessage =
        errorBody?.details ||
        errorBody?.error ||
        response.statusText ||
        "Failed to generate prompt";
      throw new Error(errorMessage);
    }

    const data = await response.json();
    console.log("API Response:", data);
    displayResults(data);
  } catch (error) {
    console.error("Error generating prompt:", error);
    showError(error.message || "Failed to generate prompt");
  } finally {
    // Reset button
    generateBtn.innerHTML = originalText;
    generateBtn.disabled = false;
  }
}

function displayResults(data) {
  const resultsDiv = document.getElementById("synthesizer-results");

  // Populate basic fields
  document.getElementById("result-title").textContent =
    data.title || "Generated Prompt";
  const systemField = document.getElementById("result-system");
  const userField = document.getElementById("result-user");
  const cohesiveField = document.getElementById("result-cohesive");
  [systemField, userField, cohesiveField].forEach((field) => {
    if (!field) return;
    field.readOnly = false;
    field.disabled = false;
  });
  systemField.value = data.system || "";
  userField.value = data.user || "";

  // Ensure editable sections are visible
  const systemSection = document
    .getElementById("result-system")
    .closest(".result-section");
  const userSection = document
    .getElementById("result-user")
    .closest(".result-section");
  if (systemSection) systemSection.style.display = "block";
  if (userSection) userSection.style.display = "block";

  // Show guardrails if available
  if (data.guardrails && data.guardrails.length > 0) {
    const guardrailsSection = document.getElementById("guardrails-section");
    const guardrailsContent = document.getElementById("result-guardrails");
    guardrailsContent.innerHTML = data.guardrails
      .map((rail) => `<li>${rail}</li>`)
      .join("");
    guardrailsSection.style.display = "block";
  }

  // Show few-shots if available
  if (data.few_shots && data.few_shots.length > 0) {
    const fewShotsSection = document.getElementById("few-shots-section");
    const fewShotsContent = document.getElementById("result-few-shots");
    fewShotsContent.innerHTML = data.few_shots
      .map(
        (shot) =>
          `<div class="few-shot-example">
        <strong>Input:</strong> ${shot.input}<br>
        <strong>Ideal Output:</strong> ${shot.ideal}
      </div>`
      )
      .join("");
    fewShotsSection.style.display = "block";
  }

  // Show tools if available (cleaned up display)
  if (data.tools_suggested && data.tools_suggested.length > 0) {
    const toolsSection = document.getElementById("tools-section");
    const toolsContent = document.getElementById("result-tools");
    toolsContent.innerHTML = data.tools_suggested
      .map(
        (tool) =>
          `<div class="tool-suggestion">
        <strong>${
          tool.name || tool.toolName || tool.tool || "Tool"
        }:</strong> ${tool.description || tool.purpose || ""}
      </div>`
      )
      .join("");
    toolsSection.style.display = "block";
  }

  // Show telemetry tags if available
  if (data.telemetry_tags && data.telemetry_tags.length > 0) {
    const tagsSection = document.getElementById("tags-section");
    const tagsContent = document.getElementById("result-tags");
    tagsContent.innerHTML = data.telemetry_tags
      .map((tag) => `<span class="tag">${tag}</span>`)
      .join(" ");
    tagsSection.style.display = "block";
  }

  // Create and show cohesive prompt combining system, user, and guardrails
  let cohesivePrompt = "";

  if (data.system) {
    cohesivePrompt += `SYSTEM:\n${data.system}\n\n`;
  }

  if (data.user) {
    cohesivePrompt += `USER:\n${data.user}\n\n`;
  }

  if (data.guardrails && data.guardrails.length > 0) {
    cohesivePrompt += `GUARDRAILS:\n${data.guardrails
      .map((rail) => `• ${rail}`)
      .join("\n")}\n\n`;
  }

  // Hide individual sections and show only cohesive prompt
  const guardrailsSection = document.getElementById("guardrails-section");
  guardrailsSection.style.display = "none";

  const cohesiveSection = document.getElementById("cohesive-section");
  const cohesiveContent = document.getElementById("result-cohesive");
  cohesiveContent.value = cohesivePrompt.trim();
  cohesiveContent.readOnly = false;
  cohesiveContent.disabled = false;
  cohesiveSection.style.display = "block";

  // Show results
  resultsDiv.style.display = "block";
  resultsDiv.scrollIntoView({ behavior: "smooth" });
}

function showError(message) {
  const errorDiv = document.getElementById("synthesizer-error");
  const errorContent = document.getElementById("error-content");
  errorContent.textContent = message;
  errorDiv.style.display = "block";
  errorDiv.scrollIntoView({ behavior: "smooth" });
}

function copyToClipboard(elementId) {
  const element = document.getElementById(elementId);
  // Support both static divs and editable textareas
  const text =
    element.value !== undefined ? element.value : element.textContent;

  navigator.clipboard
    .writeText(text)
    .then(() => {
      showToast("Copied to clipboard!", "success");
    })
    .catch((err) => {
      console.error("Failed to copy: ", err);
      showToast("Failed to copy to clipboard", "error");
    });
}

// -------------------- Project management helpers --------------------
async function loadProjects() {
  if (!sessionToken) return;
  try {
    const response = await fetch(`${API_ENDPOINTS.auth}/projects`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) throw new Error("Failed to load projects");
    const data = await response.json();
    projectCache = (data.projects || []).map((p) => ({
      ...p,
      details: normalizeDetails(p.details),
    }));
    renderProjectOptions();
    if (activeProjectId) {
      await loadFeaturesForProject(activeProjectId);
    }
  } catch (err) {
    console.error("Project load failed:", err);
  }
}

function renderProjectOptions() {
  const mainSelect = document.getElementById("project-select");
  const modalList = document.getElementById("projects-list");
  const hint = document.getElementById("project-context-hint");
  if (mainSelect) {
    mainSelect.innerHTML = '<option value="">Ad-hoc (no project)</option>';
    projectCache.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      mainSelect.appendChild(opt);
    });
    if (activeProjectId) mainSelect.value = activeProjectId;
  }
  if (hint) {
    hint.textContent = "";
  }
  // modalList hidden for more space
  renderFeatureOptions();
}

function setActiveProject(id, label) {
  activeProjectId = id ? String(id) : "";
  localStorage.setItem("active_project_id", activeProjectId);
  const projectSelect = document.getElementById("project-select");
  if (projectSelect) projectSelect.value = activeProjectId;
  // Reset feature when project changes
  activeFeatureId = "";
  localStorage.removeItem("active_feature_id");
  renderFeatureOptions();
  if (activeProjectId) {
    loadFeaturesForProject(activeProjectId);
  }
  renderProjectOptions();
}

async function loadFeaturesForProject(projectId) {
  if (!sessionToken || !projectId) return;
  try {
    const resp = await fetch(
      `${API_ENDPOINTS.auth}/projects/${projectId}/features`,
      {
        headers: { Authorization: `Bearer ${sessionToken}` },
      }
    );
    if (!resp.ok) throw new Error("Failed to load features");
    const data = await resp.json();
    featureCache[projectId] = (data.features || []).map((f) => ({
      ...f,
      details: normalizeDetails(f.details),
    }));
    // default selection
    const existing = featureCache[projectId];
    if (!activeFeatureId && existing.length > 0) {
      activeFeatureId = String(existing[0].id);
      localStorage.setItem("active_feature_id", activeFeatureId);
    }
    renderFeatureOptions();
    if (activeFeatureId) {
      const feat = featureCache[projectId].find(
        (f) => String(f.id) === String(activeFeatureId)
      );
      if (feat) populateFeatureForm(feat);
    } else {
      clearFeatureForm();
    }
  } catch (err) {
    console.error("Feature load failed:", err);
  }
}

function renderFeatureOptions() {
  const select = document.getElementById("feature-select");
  const list = featureCache[activeProjectId] || [];
  if (select) {
    select.innerHTML = '<option value="">None</option>';
    list.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.name;
      select.appendChild(opt);
    });
    if (activeFeatureId) select.value = activeFeatureId;
  }

  const featureListDiv = document.getElementById("features-list");
  if (featureListDiv) {
    featureListDiv.innerHTML = "";
    if (list.length === 0) {
      featureListDiv.innerHTML = "<p>No features.</p>";
    } else {
      list.forEach((f) => {
        const div = document.createElement("div");
        div.className = "projects-list-simple-item";
        if (String(f.id) === String(activeFeatureId)) {
          div.classList.add("active");
        }
        div.textContent = f.name;
        div.onclick = () => {
          activeFeatureId = String(f.id);
          localStorage.setItem("active_feature_id", activeFeatureId);
          if (select) select.value = activeFeatureId;
          populateFeatureForm(f);
          renderFeatureOptions();
        };
        featureListDiv.appendChild(div);
      });
    }
  }
}

function handleProjectSelectChange() {
  const select = document.getElementById("project-select");
  activeProjectId = select?.value || "";
  localStorage.setItem("active_project_id", activeProjectId);
  activeFeatureId = "";
  localStorage.removeItem("active_feature_id");
  clearFeatureForm();
  renderFeatureOptions();
  if (activeProjectId) {
    loadFeaturesForProject(activeProjectId);
  }
}

function handleFeatureSelectChange() {
  const select = document.getElementById("feature-select");
  activeFeatureId = select?.value || "";
  if (activeFeatureId) {
    localStorage.setItem("active_feature_id", activeFeatureId);
    const list = featureCache[activeProjectId] || [];
    const feat = list.find((f) => String(f.id) === String(activeFeatureId));
    if (feat) populateFeatureForm(feat);
  } else {
    localStorage.removeItem("active_feature_id");
    clearFeatureForm();
  }
}

function renderProjectsOverview() {
  const list = document.getElementById("projects-screen-list");
  if (!list) return;
  if (!projectCache.length) {
    list.innerHTML =
      "<p>No projects yet. Create one to reuse info across phases.</p>";
    return;
  }
  list.innerHTML = "";
  projectCache.forEach((p) => {
    const general = p.details?.general || {};
    const card = document.createElement("div");
    card.className = "projects-screen-card";
    const title = document.createElement("h4");
    title.textContent = p.name || "Untitled Project";
    const desc = document.createElement("p");
    desc.textContent = general.overview || "No description yet.";
    const meta = document.createElement("div");
    const featureCount = (featureCache[p.id] || []).length;
    meta.className = "projects-screen-meta";
    meta.textContent = `Features: ${featureCount}`;
    const actions = document.createElement("div");
    actions.className = "project-actions-simple";

    const manageBtn = document.createElement("button");
    manageBtn.className = "btn btn-primary btn-sm";
    manageBtn.textContent = "Manage";
    manageBtn.onclick = () => {
      setActiveProject(p.id);
      openProjectManager();
    };

    const discoveryBtn = document.createElement("button");
    discoveryBtn.className = "btn btn-secondary btn-sm";
    discoveryBtn.textContent = "Start Discovery";
    discoveryBtn.onclick = () => {
      setActiveProject(p.id);
      selectPhase("discovery");
    };

    actions.appendChild(manageBtn);
    actions.appendChild(discoveryBtn);

    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(meta);
    card.appendChild(actions);
    list.appendChild(card);
  });
}

function openProjectManager() {
  const modal = document.getElementById("project-modal");
  if (modal) {
    modal.style.display = "flex";
    renderProjectOptions();
    if (activeProjectId) {
      const proj = projectCache.find(
        (p) => String(p.id) === String(activeProjectId)
      );
      if (proj) selectProjectInModal(proj);
    } else {
      populateProjectForm(null);
      renderFeatureOptions();
    }
  }
}

function closeProjectManager() {
  const modal = document.getElementById("project-modal");
  if (modal) modal.style.display = "none";
}

function startNewProjectFlow() {
  setActiveProject("");
  clearFeatureForm();
  populateProjectForm(null);
  openProjectManager();
}

function populateProjectForm(proj) {
  document.getElementById("project-name-input").value = proj?.name || "";
  document.getElementById("project-description-input").value =
    proj?.details?.general?.overview ||
    proj?.details?.general?.description ||
    "";
  document.getElementById("project-stakeholders-input").value =
    proj?.details?.general?.stakeholders || "";
  document.getElementById("project-team-input").value =
    proj?.details?.general?.teamMembers || "";
  document.getElementById("project-roles-input").value =
    proj?.details?.general?.roles || "";
  document.getElementById("project-acstyle-input").value =
    proj?.details?.general?.acStyle || "";
}

function selectProjectInModal(proj) {
  activeProjectId = String(proj.id);
  localStorage.setItem("active_project_id", activeProjectId);
  populateProjectForm(proj);
  renderProjectOptions();
  loadFeaturesForProject(activeProjectId);
  updateResponsePreview();
}

function populateFeatureForm(feature) {
  document.getElementById("feature-name-input").value = feature?.name || "";
  const general = feature?.details?.general || {};
  const sizeVal = general.tShirtSize || general.size;
  const descVal = general.description || general.overview;
  const sizeInput = document.getElementById("feature-size-input");
  const descInput = document.getElementById("feature-desc-input");
  if (sizeInput && sizeVal) sizeInput.value = sizeVal;
  if (descInput && descVal) descInput.value = descVal;
  updateResponsePreview();
}

async function saveProject() {
  if (!sessionToken) {
    showToast("Please log in to save projects", "error");
    return;
  }
  const name = (
    document.getElementById("project-name-input")?.value || ""
  ).trim();
  if (!name) {
    showToast("Project name required", "error");
    return;
  }
  const general = {
    overview: document.getElementById("project-description-input")?.value || "",
    stakeholders:
      document.getElementById("project-stakeholders-input")?.value || "",
    teamMembers: document.getElementById("project-team-input")?.value || "",
    roles: document.getElementById("project-roles-input")?.value || "",
    acStyle: document.getElementById("project-acstyle-input")?.value || "",
    name,
  };
  const details = { general };
  const payload = { name, details };
  try {
    let resp;
    if (activeProjectId) {
      resp = await fetch(
        `${API_ENDPOINTS.auth}/projects/${activeProjectId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify(payload),
        }
      );
    } else {
      resp = await fetch(`${API_ENDPOINTS.auth}/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(payload),
      });
    }
    if (!resp.ok) throw new Error("Project save failed");
    await loadProjects();
    showToast("Project saved", "success");
  } catch (err) {
    console.error(err);
    showToast("Failed to save project", "error");
  }
}

async function deleteProject() {
  if (!activeProjectId) {
    showToast("Select a project first", "error");
    return;
  }
  try {
    const resp = await fetch(
      `${API_ENDPOINTS.auth}/projects/${activeProjectId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${sessionToken}` },
      }
    );
    if (!resp.ok) throw new Error("Delete failed");
    activeProjectId = "";
    localStorage.removeItem("active_project_id");
    await loadProjects();
    renderFeatureOptions();
    showToast("Project deleted", "success");
  } catch (err) {
    console.error(err);
    showToast("Failed to delete project", "error");
  }
}

function clearFeatureForm() {
  document.getElementById("feature-name-input").value = "";
  document.getElementById("feature-size-input").value = "";
  document.getElementById("feature-desc-input").value = "";
  activeFeatureId = "";
  localStorage.removeItem("active_feature_id");
  const select = document.getElementById("feature-select");
  if (select) select.value = "";
}

async function saveFeature() {
  if (!activeProjectId) {
    showToast("Select a project first", "error");
    return;
  }
  if (!sessionToken) {
    showToast("Please log in to save features", "error");
    return;
  }
  const name = (
    document.getElementById("feature-name-input")?.value || ""
  ).trim();
  if (!name) {
    showToast("Feature name required", "error");
    return;
  }
  const details = {
    general: {
      description: document.getElementById("feature-desc-input")?.value || "",
      tShirtSize: document.getElementById("feature-size-input")?.value || "",
      name,
    },
  };
  try {
    let resp;
    if (activeFeatureId) {
      resp = await fetch(
        `${API_ENDPOINTS.auth}/projects/${activeProjectId}/features/${activeFeatureId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({ name, details }),
        }
      );
    } else {
      resp = await fetch(
        `${API_ENDPOINTS.auth}/projects/${activeProjectId}/features`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({ name, details }),
        }
      );
    }
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(errBody.error || "Feature save failed");
    }
    const data = await resp.json();
    const saved = data.feature;
    const normalized = {
      ...saved,
      details: normalizeDetails(saved.details),
    };
    const list = featureCache[activeProjectId] || [];
    featureCache[activeProjectId] = list.filter((f) => f.id !== normalized.id);
    featureCache[activeProjectId].unshift(normalized);
    activeFeatureId = String(normalized.id);
    localStorage.setItem("active_feature_id", activeFeatureId);
    renderFeatureOptions();
    populateFeatureForm(normalized);
    // keep form inputs in sync with saved details
    const sizeInput = document.getElementById("feature-size-input");
    const descInput = document.getElementById("feature-desc-input");
    if (sizeInput && normalized.details?.general?.tShirtSize) {
      sizeInput.value = normalized.details.general.tShirtSize;
    }
    if (descInput && normalized.details?.general?.description) {
      descInput.value = normalized.details.general.description;
    }
    // Reload from server to ensure consistency
    await loadFeaturesForProject(activeProjectId);
    showToast("Feature saved", "success");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Failed to save feature", "error");
  }
}

async function deleteFeatureEntry() {
  if (!activeProjectId || !activeFeatureId) {
    showToast("Select a feature to delete", "error");
    return;
  }
  try {
    const resp = await fetch(
      `${API_ENDPOINTS.auth}/projects/${activeProjectId}/features/${activeFeatureId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${sessionToken}` },
      }
    );
    if (!resp.ok) throw new Error("Delete failed");
    featureCache[activeProjectId] = (
      featureCache[activeProjectId] || []
    ).filter((f) => String(f.id) !== String(activeFeatureId));
    clearFeatureForm();
    renderFeatureOptions();
    // reset active feature id after deletion
    activeFeatureId = "";
    localStorage.removeItem("active_feature_id");
    showToast("Feature deleted", "success");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Failed to delete feature", "error");
  }
}

function startNewFeature() {
  clearFeatureForm();
  const nameInput = document.getElementById("feature-name-input");
  if (nameInput) nameInput.focus();
}

function applyGeneralMapping(general) {
  if (!general) return false;
  const mapTargets = [
    { ids: ["project-name", "projectName"], value: general.name || "" },
    {
      ids: [
        "project-description",
        "featureDescription",
        "businessGoals",
        "business-objectives",
        "functional-requirements",
        "current-pain-points",
      ],
      value: general.overview || general.description || "",
    },
    {
      ids: ["featureDescription"],
      value: general.description || general.overview || "",
    },
    {
      ids: ["stakeholders", "key-stakeholders"],
      value: general.stakeholders || "",
    },
    {
      ids: [
        "goals",
        "primary-goals",
        "acceptanceCriteria",
        "success-metrics",
        "non-functional-requirements",
      ],
      value: general.goals || "",
    },
  ];
  let applied = false;
  const formFields = getFormFieldsRoot();
  mapTargets.forEach(({ ids, value }) => {
    if (!value) return;
    ids.forEach((id) => {
      const el = formFields ? formFields.querySelector(`#${id}`) : null;
      if (el && (!el.value || el.value.trim() === "")) {
        el.value = value;
        applied = true;
      }
    });
  });
  return applied;
}

function normalizeList(val = "") {
  return (val || "")
    .split(/[,\n;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function mergeList(existing = "", incoming = []) {
  const base = normalizeList(existing);
  const lower = new Set(base.map((s) => s.toLowerCase()));
  incoming.forEach((val) => {
    if (!val) return;
    const trimmed = val.trim();
    if (trimmed && !lower.has(trimmed.toLowerCase())) {
      base.push(trimmed);
      lower.add(trimmed.toLowerCase());
    }
  });
  return base.join(", ");
}

// Lightweight path helpers (general.path)
function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function setByPath(target, path, value) {
  if (!target || !path) return;
  const parts = path.split(".");
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    cursor[key] = cursor[key] || {};
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

// Deterministic inference: derive project/feature updates and suggestions
function deriveProjectUpdates({ project, feature, formId, formValues }) {
  const map = buildSemanticMap(formId) || {};
  const projectUpdates = { general: {} };
  const featureUpdates = { general: {} };
  const suggestions = [];

  Object.entries(map).forEach(([fieldKey, meta]) => {
    const value = formValues[fieldKey];
    if (value === undefined || value === null) return;
    const trimmed = typeof value === "string" ? value.trim() : value;
    if (!trimmed) return;

    const entityDetails =
      meta.entity === "feature"
        ? feature?.details || {}
        : project?.details || {};
    const currentVal = getByPath(entityDetails, meta.path);

    if (meta.isList) {
      const incomingItems = normalizeList(trimmed);
      if (!incomingItems.length) return;
      const currentList = normalizeList(currentVal || "");
      const newItems = incomingItems.filter(
        (v) =>
          !currentList.some(
            (existing) => existing.toLowerCase() === v.toLowerCase()
          )
      );
      if (!newItems.length) return;
      const merged = mergeList(currentVal || "", newItems);
      if (meta.entity === "feature") {
        setByPath(featureUpdates, meta.path, merged);
      } else {
        setByPath(projectUpdates, meta.path, merged);
      }
      suggestions.push({
        entity: meta.entity,
        path: meta.path,
        label: meta.label || fieldKey,
        oldValue: currentVal || "",
        newValue: merged,
      });
      return;
    }

    const currentString = (currentVal || "").toString().trim();
    if (!currentString || currentString !== trimmed) {
      if (meta.entity === "feature") {
        setByPath(featureUpdates, meta.path, trimmed);
      } else {
        setByPath(projectUpdates, meta.path, trimmed);
      }
      suggestions.push({
        entity: meta.entity,
        path: meta.path,
        label: meta.label || fieldKey,
        oldValue: currentVal || "",
        newValue: trimmed,
      });
    }
  });

  return { projectUpdates, featureUpdates, suggestions };
}

// Apply value into standard inputs or special widgets (participant table)
function setFieldValue(fieldKey, targetEl, val) {
  // Participant table hidden input
  if (targetEl.type === "hidden" || targetEl.classList.contains("participant-table")) {
    populateParticipantTableFromString(fieldKey, val);
    return;
  }
  targetEl.value = val;
}

function populateParticipantTableFromString(fieldName, val) {
  const tbody = document.getElementById(`${fieldName}-tbody`);
  const hidden = document.querySelector(`input[type="hidden"][name="${fieldName}"]`);
  if (!tbody || !hidden) return;
  tbody.innerHTML = "";
  const entries = normalizeList(val).map((v) => {
    const parts = v.split("-").map((p) => p.trim());
    return { name: parts[0] || "", role: parts.slice(1).join("-") || "" };
  });
  if (!entries.length) {
    addParticipantRow(fieldName);
    hidden.value = "";
    return;
  }
  entries.forEach((entry) => {
    addParticipantRow(fieldName);
    const lastRow = tbody.lastElementChild;
    if (!lastRow) return;
    const nameInput = lastRow.querySelector(".participant-name");
    const roleSelect = lastRow.querySelector(".participant-role");
    if (nameInput) nameInput.value = entry.name || "";
    if (roleSelect && entry.role) {
      // try exact match else fallback to first option
      const match = Array.from(roleSelect.options).find(
        (opt) => opt.value.toLowerCase() === entry.role.toLowerCase() || opt.textContent.toLowerCase() === entry.role.toLowerCase()
      );
      roleSelect.value = match ? match.value : roleSelect.value;
    }
  });
  // update hidden value
  updateParticipantData(fieldName);
}

async function applySuggestions() {
  if (!sessionToken) {
    showToast("Please log in to save project updates", "error");
    return;
  }
  if (!activeProjectId) {
    dismissSuggestions();
    showToast("Select a project before saving suggestions", "error");
    return;
  }
  const proj = projectCache.find(
    (p) => String(p.id) === String(activeProjectId)
  );
  if (!proj) {
    dismissSuggestions();
    return;
  }
  const featureList = featureCache[activeProjectId] || [];
  const feat = featureList.find(
    (f) => String(f.id) === String(activeFeatureId)
  );
  const formValues = collectRawFormValues();
  const phaseKey =
    currentPhase || document.getElementById("phase-select")?.value;

  const updates = pendingUpdatePayload || {};
  const projUpdates = updates.projectUpdates || {};
  const featureUpdates = updates.featureUpdates || {};

  // Apply to project
  const projDetails = { ...(proj.details || {}) };
  projDetails.general = { ...(projDetails.general || {}) };
  projDetails.phaseData = projDetails.phaseData || {};
  if (phaseKey) {
    projDetails.phaseData[phaseKey] = formValues;
  }
  if (projUpdates.general) {
    Object.entries(projUpdates.general).forEach(([key, val]) => {
      projDetails.general[key] = val;
    });
  }

  try {
    const resp = await fetch(
      `${API_ENDPOINTS.auth}/projects/${activeProjectId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ name: proj.name, details: projDetails }),
      }
    );
    if (!resp.ok) throw new Error("Project update failed");
    const data = await resp.json();
    const saved = data.project;
    const normalized = {
      ...saved,
      details: saved.details ? JSON.parse(saved.details) : {},
    };
    projectCache = projectCache.map((p) =>
      p.id === normalized.id ? normalized : p
    );
    // Feature update if needed
    if (
      feat &&
      featureUpdates.general &&
      Object.keys(featureUpdates.general).length
    ) {
      const fDetails = { ...(feat.details || {}) };
      fDetails.general = { ...(fDetails.general || {}), ...featureUpdates.general };
      fDetails.phaseData = fDetails.phaseData || {};
      if (phaseKey) fDetails.phaseData[phaseKey] = formValues;
      const fResp = await fetch(
        `${API_ENDPOINTS.auth}/projects/${activeProjectId}/features/${activeFeatureId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({ name: feat.name, details: fDetails }),
        }
      );
      if (!fResp.ok) throw new Error("Feature update failed");
      const fData = await fResp.json();
      const fSaved = fData.feature;
      const fNorm = {
        ...fSaved,
        details: fSaved.details ? JSON.parse(fSaved.details) : {},
      };
      featureCache[activeProjectId] = featureCache[activeProjectId].map((f) =>
        f.id === fNorm.id ? fNorm : f
      );
      populateFeatureForm(fNorm);
    }
    pendingSuggestions = [];
    pendingUpdatePayload = null;
    const banner = document.getElementById("project-suggestion-banner");
    if (banner) banner.style.display = "none";
    renderProjectOptions();
    renderFeatureOptions();
    showToast("Saved updates to project", "success");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Failed to save project updates", "error");
  }
}

function dismissSuggestions() {
  pendingSuggestions = [];
  pendingUpdatePayload = null;
  const banner = document.getElementById("project-suggestion-banner");
  if (banner) banner.style.display = "none";
}

function updateSuggestionBanner(suggestions = []) {
  const banner = document.getElementById("project-suggestion-banner");
  const bannerText = document.getElementById("suggestion-text");
  const list = document.getElementById("suggestion-list");
  if (!banner || !bannerText || !list) return;
  if (!suggestions.length) {
    banner.style.display = "none";
    list.innerHTML = "";
    return;
  }
  bannerText.textContent = `We found ${suggestions.length} ${
    suggestions.length === 1 ? "update" : "updates"
  } to reuse across phases.`;
  list.innerHTML = suggestions
    .map(
      (s) =>
        `<div>• ${s.label}: ${s.oldValue ? `${s.oldValue} → ` : ""}${s.newValue}</div>`
    )
    .join("");
  banner.style.display = "flex";
}

function updateResponsePreview() {
  const preview = document.getElementById("project-response-preview");
  if (!preview) return;
  const proj = projectCache.find(
    (p) => String(p.id) === String(activeProjectId)
  );
  const feats = featureCache[activeProjectId] || [];
  const feat = feats.find((f) => String(f.id) === String(activeFeatureId));
  const phaseKey =
    currentPhase ||
    document.getElementById("phase-select")?.value ||
    "discovery";
  const projPhase = proj?.details?.phaseData || {};
  const featPhase = feat?.details?.phaseData || {};

  const parts = [];
  Object.entries(projPhase).forEach(([phase, data]) => {
    if (data?.llmResponse) {
      parts.push(`Project • ${phase}:\n${data.llmResponse}`);
    }
  });
  Object.entries(featPhase).forEach(([phase, data]) => {
    if (data?.llmResponse) {
      parts.push(`Feature • ${phase}:\n${data.llmResponse}`);
    }
  });

  preview.textContent = parts.length
    ? parts.join("\n\n")
    : "No saved responses yet.";
}

async function savePhaseSubmission(phase, payload) {
  if (!sessionToken) return;
  try {
    const resp = await fetch(`${API_ENDPOINTS.auth}/submissions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        phase,
        payload,
        projectId: activeProjectId || null,
        featureId: activeFeatureId || null,
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.warn(
        "Phase submission save failed",
        err.error || resp.statusText
      );
    }
  } catch (err) {
    console.warn("Phase submission save failed", err);
  }
}

// Heuristic mapping: match inputs by label keywords against project data
function applyHeuristicMapping(data = {}) {
  const formFields = getFormFieldsRoot();
  if (!formFields) return false;

  const inputs = formFields.querySelectorAll("input, textarea, select");
  let applied = false;

  inputs.forEach((el) => {
    if (el.value && el.value.trim() !== "") return; // don’t overwrite
    // Avoid setting incompatible field types (dates, numbers, etc.)
    const disallowedTypes = ["date", "time", "datetime-local", "number"];
    if (disallowedTypes.includes(el.type)) return;
    const group = el.closest(".form-group");
    const label =
      group?.querySelector("label")?.textContent?.toLowerCase() || "";

    const candidates = [];
    if (label.includes("name") || label.includes("title"))
      candidates.push(data.name);
    if (label.includes("feature"))
      candidates.push(
        data.featureDescription || data.description || data.overview
      );
    if (label.includes("description") || label.includes("overview"))
      candidates.push(data.description || data.overview);
    if (label.includes("stakeholder")) candidates.push(data.stakeholders);
    if (
      label.includes("goal") ||
      label.includes("objective") ||
      label.includes("success")
    )
      candidates.push(data.goals);
    if (label.includes("requirement"))
      candidates.push(data.requirements || data.overview);
    if (label.includes("pain") || label.includes("issue"))
      candidates.push(data.issues || data.overview);
    if (label.includes("role") || label.includes("team"))
      candidates.push(data.roles || data.teamMembers);
    if (
      label.includes("acceptance") ||
      label.includes("criteria") ||
      label.includes("gherkin")
    )
      candidates.push(data.acStyle);
    if (label.includes("response") || label.includes("summary"))
      candidates.push(data.llmResponse || data.requirements || data.overview);

    // If this is a select, try to match the closest option instead of setting raw text
    if (el.tagName === "SELECT") {
      const rolesString = candidates.find((v) => v && v.trim()) || "";
      const roleTokens = rolesString
        .split(",")
        .map((r) => r.trim().toLowerCase())
        .filter(Boolean);
      const options = Array.from(el.options || []);
      let bestMatch = null;
      let bestScore = 0;
      options.forEach((opt) => {
        const optText = (opt.textContent || "").toLowerCase();
        const optVal = (opt.value || "").toLowerCase();
        roleTokens.forEach((token) => {
          if (!token) return;
          const direct = optText === token || optVal === token;
          const includes = optText.includes(token) || token.includes(optText) || optVal.includes(token);
          const score = direct ? token.length + 5 : includes ? token.length : 0;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = opt;
          }
        });
      });
      if (bestMatch) {
        el.value = bestMatch.value;
        applied = true;
      }
      return;
    }

    const val = candidates.find((v) => v && v.trim());
    if (val) {
      el.value = val;
      applied = true;
    }
  });

  return applied;
}

function collectRawFormValues() {
  const formFields = getFormFieldsRoot();
  const elements = formFields
    ? formFields.querySelectorAll("input, textarea, select")
    : [];
  const values = {};
  elements.forEach((el) => {
    values[el.id] = el.value;
  });
  return values;
}

function applyRawFormValues(values = {}) {
  const formFields = getFormFieldsRoot();
  if (!formFields) return;
  Object.entries(values).forEach(([id, val]) => {
    const el = formFields.querySelector(`#${id}`);
    if (el) {
      el.value = val;
    }
  });
}

// Check authentication on page load
document.addEventListener("DOMContentLoaded", function () {
  checkAuthStatus();
});

async function checkAuthStatus() {
  if (!sessionToken) {
    showAuthScreen();
    return;
  }

  try {
    const response = await fetch(`${API_ENDPOINTS.auth}/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      currentUser = data.user;
      showMainApp();
      updateUserMenu();
      await loadProjects();
    } else {
      // Invalid session
      sessionToken = null;
      localStorage.removeItem("session_token");
      showAuthScreen();
    }
  } catch (error) {
    console.error("Auth check failed:", error);
    showAuthScreen();
  }
}

function showAuthScreen() {
  hideAllScreens();
  document.getElementById("auth-screen").classList.add("active");
}

function showMainApp() {
  document.getElementById("auth-screen").classList.remove("active");
  document.getElementById("phase-selection").classList.add("active");
}

async function showProjectsScreen() {
  hideAllScreens();
  document.getElementById("projects-screen").classList.add("active");
  if (sessionToken) {
    await loadProjects();
  }
  renderProjectsOverview();
}

function showLoginForm() {
  document.getElementById("login-form").style.display = "block";
  document.getElementById("register-form").style.display = "none";
  document.getElementById("auth-error").style.display = "none";
  document.getElementById("auth-error-register").style.display = "none";
}

function showRegisterForm() {
  document.getElementById("login-form").style.display = "none";
  document.getElementById("register-form").style.display = "block";
  document.getElementById("auth-error").style.display = "none";
  document.getElementById("auth-error-register").style.display = "none";
}

async function handleLogin(event) {
  event.preventDefault();

  const username = document.getElementById("login-username").value;
  const password = document.getElementById("login-password").value;
  const errorDiv = document.getElementById("auth-error");

  try {
    const response = await fetch(`${API_ENDPOINTS.auth}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json();

    if (response.ok && data.success) {
      sessionToken = data.session_token;
      currentUser = data.user;
      localStorage.setItem("session_token", sessionToken);
      showMainApp();
      updateUserMenu();
      await loadProjects();
      showToast("Login successful!", "success");
    } else {
      errorDiv.textContent = data.error || "Login failed";
      errorDiv.style.display = "block";
    }
  } catch (error) {
    errorDiv.textContent =
      "Connection error. Please check if the server is running.";
    errorDiv.style.display = "block";
    console.error("Login error:", error);
  }
}

async function handleRegister(event) {
  event.preventDefault();

  const username = document.getElementById("register-username").value;
  const email = document.getElementById("register-email").value;
  const password = document.getElementById("register-password").value;
  const errorDiv = document.getElementById("auth-error-register");

  try {
    const response = await fetch(`${API_ENDPOINTS.auth}/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, email, password }),
    });

    const data = await response.json();

    if (response.ok && data.success) {
      sessionToken = data.session_token;
      currentUser = data.user;
      localStorage.setItem("session_token", sessionToken);
      showMainApp();
      updateUserMenu();
      await loadProjects();
      showToast("Registration successful!", "success");
    } else {
      errorDiv.textContent = data.error || "Registration failed";
      errorDiv.style.display = "block";
    }
  } catch (error) {
    errorDiv.textContent =
      "Connection error. Please check if the server is running.";
    errorDiv.style.display = "block";
    console.error("Register error:", error);
  }
}

async function logout() {
  try {
    if (sessionToken) {
      await fetch(`${API_ENDPOINTS.auth}/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      });
    }
  } catch (error) {
    console.error("Logout error:", error);
  }

  sessionToken = null;
  currentUser = null;
  localStorage.removeItem("session_token");
  localStorage.removeItem("active_project_id");
  localStorage.removeItem("active_feature_id");
  showAuthScreen();
  showToast("Logged out successfully", "success");
}

function updateUserMenu() {
  const userMenu = document.getElementById("user-menu");
  const usernameDisplay = document.getElementById("username-display");
  const userManagementLink = document.getElementById("user-management-link");
  const userProjectsLink = document.getElementById("user-projects-link");

  if (currentUser) {
    if (userMenu) userMenu.style.display = "block";
    if (usernameDisplay) usernameDisplay.textContent = currentUser.username;
    if (userManagementLink) {
      userManagementLink.style.display = currentUser.is_superuser
        ? "block"
        : "none";
    }
    if (userProjectsLink) userProjectsLink.style.display = "block";
  } else {
    if (userMenu) userMenu.style.display = "none";
    if (userProjectsLink) userProjectsLink.style.display = "none";
  }
}

function showUserMenu() {
  const dropdown = document.getElementById("user-dropdown");
  dropdown.style.display = dropdown.style.display === "none" ? "block" : "none";
}

// Close dropdown when clicking outside
document.addEventListener("click", function (event) {
  const userMenu = document.getElementById("user-menu");
  const dropdown = document.getElementById("user-dropdown");

  if (!userMenu.contains(event.target)) {
    dropdown.style.display = "none";
  }
});

// ==================== User Management Functions ====================

async function showUserManagement() {
  if (!currentUser || !currentUser.is_superuser) {
    showToast("Access denied. Superuser required.", "error");
    return;
  }

  hideAllScreens();
  document.getElementById("user-management-screen").classList.add("active");
  await loadUsers();
}

async function loadUsers() {
  try {
    const response = await fetch(`${API_ENDPOINTS.auth}/users`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      displayUsers(data.users);
    } else {
      showToast("Failed to load users", "error");
    }
  } catch (error) {
    console.error("Load users error:", error);
    showToast("Failed to load users", "error");
  }
}

function displayUsers(users) {
  const tbody = document.getElementById("users-table-body");

  if (users.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="8" style="text-align: center; padding: 20px;">No users found</td></tr>';
    return;
  }

  tbody.innerHTML = users
    .map(
      (user) => `
    <tr>
      <td>${user.id}</td>
      <td>${user.username}</td>
      <td>${user.email}</td>
      <td><span class="badge ${user.is_superuser ? "badge-success" : ""}">${
        user.is_superuser ? "Yes" : "No"
      }</span></td>
      <td><span class="badge ${
        user.is_active ? "badge-success" : "badge-danger"
      }">${user.is_active ? "Active" : "Inactive"}</span></td>
      <td>${new Date(user.created_at).toLocaleDateString()}</td>
      <td>${
        user.last_login
          ? new Date(user.last_login).toLocaleDateString()
          : "Never"
      }</td>
      <td>
        <button class="btn btn-sm btn-primary" onclick="editUser(${user.id})">
          <i class="fas fa-edit"></i> Edit
        </button>
        <button class="btn btn-sm btn-danger" onclick="deleteUserConfirm(${
          user.id
        }, '${user.username}')" ${user.id === currentUser.id ? "disabled" : ""}>
          <i class="fas fa-trash"></i> Delete
        </button>
      </td>
    </tr>
  `
    )
    .join("");
}

function showCreateUserModal() {
  document.getElementById("modal-title").textContent = "Create User";
  document.getElementById("edit-user-id").value = "";
  document.getElementById("user-form").reset();
  document.getElementById("modal-password").required = true;
  document.getElementById("modal-active").checked = true;
  document.getElementById("user-modal").style.display = "flex";
}

async function editUser(userId) {
  try {
    const response = await fetch(
      `${API_ENDPOINTS.auth}/users/${userId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      const user = data.user;

      document.getElementById("modal-title").textContent = "Edit User";
      document.getElementById("edit-user-id").value = user.id;
      document.getElementById("modal-username").value = user.username;
      document.getElementById("modal-email").value = user.email;
      document.getElementById("modal-password").value = "";
      document.getElementById("modal-password").required = false;
      document.getElementById("modal-superuser").checked = user.is_superuser;
      document.getElementById("modal-active").checked = user.is_active;
      document.getElementById("user-modal").style.display = "flex";
    } else {
      showToast("Failed to load user", "error");
    }
  } catch (error) {
    console.error("Edit user error:", error);
    showToast("Failed to load user", "error");
  }
}

function closeUserModal() {
  document.getElementById("user-modal").style.display = "none";
  document.getElementById("user-form").reset();
}

async function handleUserSubmit(event) {
  event.preventDefault();

  const userId = document.getElementById("edit-user-id").value;
  const username = document.getElementById("modal-username").value;
  const email = document.getElementById("modal-email").value;
  const password = document.getElementById("modal-password").value;
  const isSuperuser = document.getElementById("modal-superuser").checked;
  const isActive = document.getElementById("modal-active").checked;

  const userData = {
    username,
    email,
    is_superuser: isSuperuser,
    is_active: isActive,
  };

  if (password) {
    userData.password = password;
  }

  try {
    const url = userId
      ? `${API_ENDPOINTS.auth}/users/${userId}`
      : `${API_ENDPOINTS.auth}/register`;

    const method = userId ? "PUT" : "POST";

    // For new users, use admin create endpoint
    if (!userId) {
      userData.password = password;
      const response = await fetch(`${API_ENDPOINTS.auth}/users/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(userData),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        showToast("User created successfully", "success");
        closeUserModal();
        await loadUsers();
      } else {
        showToast(data.error || "Failed to create user", "error");
      }
    } else {
      // Update existing user
      const response = await fetch(url, {
        method: method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(userData),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        showToast("User updated successfully", "success");
        closeUserModal();
        await loadUsers();

        // If updating current user, refresh user info
        if (parseInt(userId) === currentUser.id) {
          await checkAuthStatus();
        }
      } else {
        showToast(data.error || "Failed to update user", "error");
      }
    }
  } catch (error) {
    console.error("User submit error:", error);
    showToast("Operation failed", "error");
  }
}

async function deleteUserConfirm(userId, username) {
  if (
    !confirm(
      `Are you sure you want to delete user "${username}"? This action cannot be undone.`
    )
  ) {
    return;
  }

  try {
    const response = await fetch(
      `${API_ENDPOINTS.auth}/users/${userId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      }
    );

    const data = await response.json();
    if (response.ok && data.success) {
      showToast("User deleted successfully", "success");
      await loadUsers();
    } else {
      showToast(data.error || "Failed to delete user", "error");
    }
  } catch (error) {
    console.error("Delete user error:", error);
    showToast("Failed to delete user", "error");
  }
}

// ---- Unified prefill override ----
async function prefillFromProject() {
  const phaseKey =
    currentPhase ||
    document.getElementById("phase-select")?.value ||
    "discovery";
  if (activeProjectId) {
    const existing = projectCache.find(
      (p) => String(p.id) === String(activeProjectId)
    );
    if (!existing) {
      await loadProjects();
    }
    if (!featureCache[activeProjectId]) {
      await loadFeaturesForProject(activeProjectId);
    }
  }
  const proj = projectCache.find(
    (p) => String(p.id) === String(activeProjectId)
  );
  const featureList = featureCache[activeProjectId] || [];
  const feat = featureList.find(
    (f) => String(f.id) === String(activeFeatureId)
  );
  if (!proj && !feat) {
    showToast("Select a project to load data", "error");
    return;
  }

  const projDetails = proj ? normalizeDetails(proj.details) : {};
  const featDetails = feat ? normalizeDetails(feat.details) : {};

  const featurePhaseData = featDetails?.phaseData || {};
  const featureGeneral = featDetails?.general || {};
  const projectPhaseData = projDetails?.phaseData || {};
  const projectGeneral = projDetails?.general || {};

  const formFields = getFormFieldsRoot();
  if (!formFields) {
    showToast("No form fields found for this phase", "info");
    return;
  }

  // Apply saved phase data first (feature preferred)
  const phaseValues =
    featurePhaseData[phaseKey] || projectPhaseData[phaseKey] || {};
  let applied = false;
  if (phaseValues && Object.keys(phaseValues).length > 0) {
    applyRawFormValues(phaseValues);
    applied = true;
  }

  const savedResponse =
    (featurePhaseData[phaseKey] || {}).llmResponse ||
    (projectPhaseData[phaseKey] || {}).llmResponse ||
    "";

  // Ordered data sources for mapping
  const sources = [
    featureGeneral || {},
    projectGeneral || {},
    featurePhaseData[phaseKey] || {},
    projectPhaseData[phaseKey] || {},
    savedResponse ? { llmResponse: savedResponse } : {},
  ];

  // Direct known mappings for core phases as a safety net
  const setIfEmpty = (id, val) => {
    if (!val) return;
    const el =
      formFields.querySelector(`#${id}`) ||
      formFields.querySelector(`[name="${id}"]`);
    if (el && (!el.value || el.value.trim() === "")) {
      setFieldValue(id, el, val);
      return true;
    }
    return false;
  };
  if (phaseKey === "discovery") {
    applied = setIfEmpty("teamMembers", projectGeneral.teamMembers) || applied;
    applied = setIfEmpty("stakeholders", projectGeneral.stakeholders) || applied;
    applied = setIfEmpty(
      "featureDescription",
      featureGeneral.description || featureGeneral.overview || projectGeneral.overview
    ) || applied;
    applied = setIfEmpty(
      "featureSize",
      featureGeneral.tShirtSize ||
        featureGeneral.size ||
        projectGeneral.tShirtSize ||
        projectGeneral.size
    ) || applied;
    applied = setIfEmpty("business-objectives", projectGeneral.goals) || applied;
  }
  if (phaseKey === "stories") {
    applied = setIfEmpty("epicName", featureGeneral.name || projectGeneral.name) || applied;
    applied = setIfEmpty(
      "storyDetails",
      featureGeneral.description || featureGeneral.overview || projectGeneral.overview
    ) || applied;
    applied = setIfEmpty("userRoles", projectGeneral.roles) || applied;
    applied = setIfEmpty("acceptanceCriteria", projectGeneral.acStyle) || applied;
  }
  if (phaseKey === "requirements") {
    applied = setIfEmpty("projectName", projectGeneral.name) || applied;
    applied = setIfEmpty("businessGoals", projectGeneral.goals) || applied;
    applied = setIfEmpty("userTypes", projectGeneral.roles) || applied;
    applied = setIfEmpty("constraints", projectGeneral.issues) || applied;
    applied = setIfEmpty("acceptanceCriteria", projectGeneral.acStyle) || applied;
    applied = setIfEmpty("meetingObjectives", projectGeneral.goals) || applied;
    applied = setIfEmpty("meetingAttendees", projectGeneral.teamMembers) || applied;
  }

  const getVal = (meta, fieldKey) => {
    for (const src of sources) {
      const direct = getByPath(src, meta.path);
      if (direct)
        return meta.isList ? normalizeList(direct).join(", ") : direct;
      if (src && src[fieldKey]) {
        const v = src[fieldKey];
        if (v) return meta.isList ? normalizeList(v).join(", ") : v;
      }
    }
    if (!meta.isList && meta.path.includes("description")) {
      const fallback =
        featureGeneral.overview ||
        projectGeneral.overview ||
        featureGeneral.description ||
        projectGeneral.description ||
        "";
      if (fallback) return fallback;
    }
    return "";
  };

  const map = buildSemanticMap(phaseKey);
  if (map && Object.keys(map).length > 0) {
    Object.entries(map).forEach(([fieldKey, meta]) => {
      let targetEl =
        formFields.querySelector(`#${fieldKey}`) ||
        formFields.querySelector(`[name="${fieldKey}"]`);
      if (!targetEl) return;
      if (targetEl.value && targetEl.value.trim() !== "") return;
      const val = getVal(meta, fieldKey);
      if (!val) return;
      setFieldValue(fieldKey, targetEl, val);
      applied = true;
    });
  }

  // Fallback: generic mapping/heuristic to catch unmapped fields
  if (!applied) {
    applied =
      applyGeneralMapping(projectGeneral) ||
      applyGeneralMapping(featureGeneral) ||
      applyHeuristicMapping({
        ...(projectGeneral || {}),
        ...(featureGeneral || {}),
        ...(phaseValues || {}),
        llmResponse: savedResponse || "",
      }) ||
      applied;
  }

  showToast(
    applied
      ? "Loaded project info into form"
      : "No saved details found for this phase yet",
    applied ? "success" : "info"
  );
}

// ensure override in case earlier definition exists
window.prefillFromProject = prefillFromProject;
