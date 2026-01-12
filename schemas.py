"""
JSON Schema validation for Prompt Synthesizer API
"""

import json
from typing import Dict, Any, List, Optional
from dataclasses import dataclass

# JSON Schema for the response structure
RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "system": {"type": "string"},
        "user": {"type": "string"},
        "guardrails": {
            "type": "array",
            "items": {"type": "string"}
        },
        "few_shots": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "input": {"type": "string"},
                    "ideal": {"type": "string"}
                },
                "required": ["input", "ideal"]
            }
        },
        "tools_suggested": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "purpose": {"type": "string"},
                    "schema": {"type": "object"}
                },
                "required": ["name", "purpose"]
            }
        },
        "telemetry_tags": {
            "type": "array",
            "items": {"type": "string"}
        }
    },
    "required": ["title", "system", "user", "guardrails"],
    "additionalProperties": False
}

@dataclass
class PromptSynthesizerRequest:
    """Request schema for prompt synthesizer"""
    phase: str
    inputs: Dict[str, Any]
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'PromptSynthesizerRequest':
        """Create request from dictionary"""
        phase = data.get('phase')
        inputs = data.get('inputs', {})
        
        if not phase:
            raise ValueError("Phase is required")
        
        valid_phases = [
            "discovery", "requirements", "wireframing", 
            "stories", "prioritization", "testing", "communication"
        ]
        
        if phase not in valid_phases:
            raise ValueError(f"Invalid phase: {phase}. Valid phases: {valid_phases}")
        
        return cls(phase=phase, inputs=inputs)

@dataclass
class PromptSynthesizerResponse:
    """Response schema for prompt synthesizer"""
    title: str
    system: str
    user: str
    guardrails: List[str]
    few_shots: Optional[List[Dict[str, str]]] = None
    tools_suggested: Optional[List[Dict[str, Any]]] = None
    telemetry_tags: Optional[List[str]] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        result = {
            "title": self.title,
            "system": self.system,
            "user": self.user,
            "guardrails": self.guardrails
        }
        
        if self.few_shots:
            result["few_shots"] = self.few_shots
        if self.tools_suggested:
            result["tools_suggested"] = self.tools_suggested
        if self.telemetry_tags:
            result["telemetry_tags"] = self.telemetry_tags
            
        return result
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'PromptSynthesizerResponse':
        """Create response from dictionary"""
        return cls(
            title=data["title"],
            system=data["system"],
            user=data["user"],
            guardrails=data["guardrails"],
            few_shots=data.get("few_shots"),
            tools_suggested=data.get("tools_suggested"),
            telemetry_tags=data.get("telemetry_tags")
        )

def validate_response(data: Dict[str, Any]) -> bool:
    """Validate response against JSON schema"""
    try:
        # Basic validation - check required fields
        required_fields = ["title", "system", "user", "guardrails"]
        for field in required_fields:
            if field not in data:
                return False
            if not isinstance(data[field], str) and field != "guardrails":
                return False
            if field == "guardrails" and not isinstance(data[field], list):
                return False
        
        return True
    except Exception:
        return False

