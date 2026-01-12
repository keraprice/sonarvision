"""
AI Provider abstraction layer for Prompt Synthesizer
Supports Google AI Studio (Gemini) and OpenAI with structured outputs
"""

import os
import json
from typing import Dict, Any, List, Optional
from abc import ABC, abstractmethod

class AIProvider(ABC):
    """Abstract base class for AI providers"""
    
    @abstractmethod
    async def synthesize_prompt(self, phase: str, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Generate a meta-prompt for the given phase and inputs"""
        pass

class GoogleProvider(AIProvider):
    """Google AI Studio (Gemini) provider"""
    
    def __init__(self):
        self.api_key = os.getenv('GOOGLE_API_KEY')
        if not self.api_key:
            raise ValueError("GOOGLE_API_KEY environment variable is required")
        
        try:
            import google.generativeai as genai
            genai.configure(api_key=self.api_key)
            self.model = genai.GenerativeModel('gemini-2.5-flash-lite')
        except ImportError:
            raise ImportError("google-generativeai package is required. Install with: pip install google-generativeai")
    
    async def synthesize_prompt(self, phase: str, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Generate meta-prompt using Gemini"""
        import google.generativeai as genai
        
        # Meta-prompt template
        meta_prompt = f"""You generate meta-prompts for Business Analysts (BA) across project phases.
Return ONLY a strict JSON object matching the provided response schema.

Phase: {phase}
Inputs: {json.dumps(inputs, separators=(',', ':'))}

Guidance for the phase:
- discovery: ask for missing stakeholders, risks, measurable success metrics; prefer clarifying questions over solutions.
- requirements: produce FR, NFR, Business Rules; flag contradictions/ambiguities.
- wireframing: propose layouts, fields, empty/error states, navigation; suggest domain components.
- stories: enforce INVEST; map to Jira fields; include Gherkin acceptance criteria patterns.
- prioritization: include t-shirt size, dependencies, risk; suggest sequencing strategies (value-first, risk-first, capacity-fit).
- testing: positive, negative, edge cases; surface coverage gaps.
- communication: audience-aware (exec/dev/PMO); call out risks, decisions, next steps.

Requirements:
1) Return production-ready meta-prompts: a SYSTEM role (behavior), a USER instruction (with actual input values substituted), optional few-shot examples.
2) Include guardrails (reduce hallucinations, request missing info).
3) If useful, list suggested tools (Jira, Confluence, Calendar, Figma) with minimal JSON schemas.
4) IMPORTANT: In the USER instruction, substitute the actual input values instead of using template variables like {{projectName}}. Use the real values from the inputs.
5) Output MUST match the schema exactly (no extra text)."""

        try:
            # Try without structured output first to see what we get
            response = self.model.generate_content(meta_prompt)
            
            # Extract text from response
            text = response.text if hasattr(response, 'text') else str(response)
            
            # Debug: print the response to see what we're getting
            print(f"AI Response: {text}")
            
            # Parse the JSON response and create a cohesive prompt
            try:
                # Clean up the response if it has markdown code blocks
                if text.startswith('```json'):
                    text = text.replace('```json', '').replace('```', '').strip()
                elif text.startswith('```'):
                    text = text.replace('```', '').strip()
                
                parsed_response = json.loads(text)
                print(f"Parsed response keys: {list(parsed_response.keys())}")
                
                # Extract prompt data from various possible structures
                prompt_data = None
                
                # Try different response structures
                if 'metaPrompts' in parsed_response and len(parsed_response['metaPrompts']) > 0:
                    prompt_data = parsed_response['metaPrompts'][0]
                elif 'meta_prompts' in parsed_response and len(parsed_response['meta_prompts']) > 0:
                    prompt_data = parsed_response['meta_prompts'][0]
                elif phase in parsed_response:
                    prompt_data = parsed_response[phase]
                elif 'discovery' in parsed_response:
                    prompt_data = parsed_response['discovery']
                else:
                    # If we can't find the expected structure, try to extract from any available data
                    print(f"Available keys in response: {list(parsed_response.keys())}")
                    # Look for any object that might contain prompt data
                    for key, value in parsed_response.items():
                        if isinstance(value, dict) and any(field in value for field in ['system', 'systemRole', 'system_role', 'user', 'userInstruction', 'user_instruction']):
                            prompt_data = value
                            break
                
                if prompt_data:
                    # Create a cohesive prompt that combines system and user instructions
                    system_role = prompt_data.get('systemRole') or prompt_data.get('system_role') or prompt_data.get('system', 'You are an expert Business Analyst.')
                    user_instruction = prompt_data.get('userInstruction') or prompt_data.get('user_instruction') or prompt_data.get('user', '')
                    guardrails = prompt_data.get('guardrails', []) if isinstance(prompt_data.get('guardrails'), list) else []
                    tools = prompt_data.get('suggestedTools') or prompt_data.get('suggested_tools') or prompt_data.get('tools', [])
                    
                    # Create cohesive prompt by combining system and user instructions
                    cohesive_prompt = f"""SYSTEM: {system_role}

USER: {user_instruction}

GUARDRAILS:
{chr(10).join(f"• {rule}" for rule in guardrails) if guardrails else "• Ensure accuracy and ask clarifying questions"}

TOOLS AVAILABLE:
{chr(10).join(f"• {tool.get('name', tool.get('tool', 'Unknown'))}: {tool.get('description', 'No description')}" for tool in tools) if tools else "• Standard BA tools (Jira, Confluence, etc.)"}"""
                    
                    result = {
                        "title": f"Cohesive {phase.title()} Prompt",
                        "system": system_role,
                        "user": user_instruction,
                        "guardrails": guardrails,
                        "few_shots": [],
                        "tools_suggested": tools,
                        "telemetry_tags": [phase, "generated"],
                        "cohesive_prompt": cohesive_prompt
                    }
                    print(f"Returning result with cohesive_prompt: {len(cohesive_prompt)} characters")
                    return result
                else:
                    # Fallback if no prompt data found - always generate cohesive prompt
                    cohesive_prompt = f"""SYSTEM: You are an expert Business Analyst specializing in {phase} phase.

USER: Generate a comprehensive prompt for the {phase} phase with the following inputs: {inputs}

GUARDRAILS:
• Ensure accuracy and ask clarifying questions
• Focus on the specific requirements of the {phase} phase
• Provide actionable guidance

TOOLS AVAILABLE:
• Standard BA tools (Jira, Confluence, etc.)"""
                    
                    result = {
                        "title": f"Generated Prompt for {phase}",
                        "system": f"You are an expert Business Analyst specializing in {phase} phase.",
                        "user": f"Generate a comprehensive prompt for the {phase} phase with inputs: {inputs}",
                        "guardrails": ["Ensure accuracy", "Ask clarifying questions"],
                        "few_shots": [],
                        "tools_suggested": [],
                        "telemetry_tags": [phase, "generated"],
                        "cohesive_prompt": cohesive_prompt
                    }
                    print(f"Fallback result with cohesive_prompt: {len(cohesive_prompt)} characters")
                    return result
                    
            except json.JSONDecodeError as e:
                print(f"JSON decode error: {e}")
                # If JSON parsing fails, return a simple cohesive structure
                cohesive_prompt = f"""SYSTEM: You are an expert Business Analyst specializing in {phase} phase.

USER: Generate a comprehensive prompt for the {phase} phase with the following inputs: {inputs}

GUARDRAILS:
• Ensure accuracy and ask clarifying questions
• Focus on the specific requirements of the {phase} phase
• Provide actionable guidance

TOOLS AVAILABLE:
• Standard BA tools (Jira, Confluence, etc.)"""
                
                return {
                    "title": f"Generated Prompt for {phase}",
                    "system": f"You are an expert Business Analyst specializing in {phase} phase.",
                    "user": f"Generate a comprehensive prompt for the {phase} phase with inputs: {inputs}",
                    "guardrails": ["Ensure accuracy", "Ask clarifying questions"],
                    "few_shots": [],
                    "tools_suggested": [],
                    "telemetry_tags": [phase, "generated"],
                    "cohesive_prompt": cohesive_prompt
                }
            
        except Exception as e:
            raise Exception(f"Google AI API error: {str(e)}")

class OpenAIProvider(AIProvider):
    """OpenAI provider using Responses API"""
    
    def __init__(self):
        self.api_key = os.getenv('OPENAI_API_KEY')
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY environment variable is required")
        
        try:
            from openai import OpenAI
            self.client = OpenAI(api_key=self.api_key)
        except ImportError:
            raise ImportError("openai package is required. Install with: pip install openai")
    
    async def synthesize_prompt(self, phase: str, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Generate meta-prompt using OpenAI"""
        # Meta-prompt template
        meta_prompt = f"""You generate meta-prompts for Business Analysts (BA) across project phases.
Return ONLY a strict JSON object matching the provided response schema.

Phase: {phase}
Inputs: {json.dumps(inputs, separators=(',', ':'))}

Guidance for the phase:
- discovery: ask for missing stakeholders, risks, measurable success metrics; prefer clarifying questions over solutions.
- requirements: produce FR, NFR, Business Rules; flag contradictions/ambiguities.
- wireframing: propose layouts, fields, empty/error states, navigation; suggest domain components.
- stories: enforce INVEST; map to Jira fields; include Gherkin acceptance criteria patterns.
- prioritization: include t-shirt size, dependencies, risk; suggest sequencing strategies (value-first, risk-first, capacity-fit).
- testing: positive, negative, edge cases; surface coverage gaps.
- communication: audience-aware (exec/dev/PMO); call out risks, decisions, next steps.

Requirements:
1) Return production-ready meta-prompts: a SYSTEM role (behavior), a USER instruction (with actual input values substituted), optional few-shot examples.
2) Include guardrails (reduce hallucinations, request missing info).
3) If useful, list suggested tools (Jira, Confluence, Calendar, Figma) with minimal JSON schemas.
4) IMPORTANT: In the USER instruction, substitute the actual input values instead of using template variables like {{projectName}}. Use the real values from the inputs.
5) Output MUST match the schema exactly (no extra text)."""

        try:
            # Use OpenAI Responses API with structured outputs
            response = self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a prompt engineering expert for Business Analysis workflows."},
                    {"role": "user", "content": meta_prompt}
                ],
                response_format={"type": "json_object"},
                temperature=0.2
            )
            
            # Extract and parse JSON response
            content = response.choices[0].message.content
            result = json.loads(content)
            return result
            
        except Exception as e:
            raise Exception(f"OpenAI API error: {str(e)}")

def get_provider() -> AIProvider:
    """Get the configured AI provider"""
    provider = os.getenv('AI_PROVIDER', 'google').lower()
    
    if provider == 'openai':
        return OpenAIProvider()
    elif provider == 'google':
        return GoogleProvider()
    else:
        raise ValueError(f"Unsupported AI provider: {provider}. Supported: 'google', 'openai'")

async def synthesize_prompt(phase: str, inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Main entry point for prompt synthesis"""
    provider = get_provider()
    return await provider.synthesize_prompt(phase, inputs)
