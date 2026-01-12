"""
Flask API endpoint for Prompt Synthesizer
POST /api/prompt-synthesizer
"""

import json
import asyncio
from flask import Blueprint, request, jsonify
from schemas import PromptSynthesizerRequest, PromptSynthesizerResponse, validate_response
from ai_providers import synthesize_prompt

# Create blueprint for the API
prompt_synthesizer_bp = Blueprint('prompt_synthesizer', __name__)

@prompt_synthesizer_bp.route('/api/prompt-synthesizer', methods=['POST'])
def synthesize():
    """Generate meta-prompt for Business Analyst phases"""
    try:
        # Parse request data
        data = request.get_json()
        if not data:
            return jsonify({"error": "Request body must be JSON"}), 400
        
        # Validate request
        try:
            req = PromptSynthesizerRequest.from_dict(data)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        
        # Generate prompt using AI provider
        try:
            # Run async function in sync context
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            result = loop.run_until_complete(synthesize_prompt(req.phase, req.inputs))
            loop.close()
        except Exception as e:
            return jsonify({"error": f"AI provider error: {str(e)}"}), 500
        
        # Validate response
        if not validate_response(result):
            return jsonify({"error": "Invalid response from AI provider"}), 500
        
        # Create response object
        try:
            response = PromptSynthesizerResponse.from_dict(result)
        except Exception as e:
            return jsonify({"error": f"Response validation error: {str(e)}"}), 500
        
        # Return successful response
        return jsonify(response.to_dict()), 200
        
    except Exception as e:
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500

@prompt_synthesizer_bp.route('/api/prompt-synthesizer/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        # Check if AI provider is configured
        from ai_providers import get_provider
        provider = get_provider()
        return jsonify({"status": "healthy", "provider": type(provider).__name__}), 200
    except Exception as e:
        return jsonify({"status": "unhealthy", "error": str(e)}), 500

