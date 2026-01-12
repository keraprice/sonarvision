#!/usr/bin/env python3
"""
Simple test for Prompt Synthesizer functionality
"""

import json
import os
import sys
from schemas import PromptSynthesizerRequest, PromptSynthesizerResponse, validate_response

def test_schema_validation():
    """Test schema validation functions"""
    print("Testing schema validation...")
    
    # Test valid request
    try:
        req = PromptSynthesizerRequest.from_dict({
            "phase": "discovery",
            "inputs": {"stakeholders": ["PM", "Dev Team"]}
        })
        print("✅ Valid request creation: PASSED")
    except Exception as e:
        print(f"❌ Valid request creation: FAILED - {e}")
        return False
    
    # Test invalid phase
    try:
        req = PromptSynthesizerRequest.from_dict({
            "phase": "invalid_phase",
            "inputs": {}
        })
        print("❌ Invalid phase validation: FAILED - Should have raised error")
        return False
    except ValueError:
        print("✅ Invalid phase validation: PASSED")
    
    # Test response validation
    valid_response = {
        "title": "Test Prompt",
        "system": "You are a BA expert",
        "user": "Generate requirements",
        "guardrails": ["Be specific", "Ask clarifying questions"]
    }
    
    if validate_response(valid_response):
        print("✅ Valid response validation: PASSED")
    else:
        print("❌ Valid response validation: FAILED")
        return False
    
    return True

def test_ai_provider_import():
    """Test AI provider imports"""
    print("Testing AI provider imports...")
    
    try:
        from ai_providers import get_provider, synthesize_prompt
        print("✅ AI provider imports: PASSED")
        return True
    except ImportError as e:
        print(f"❌ AI provider imports: FAILED - {e}")
        return False
    except Exception as e:
        print(f"❌ AI provider imports: FAILED - {e}")
        return False

def test_api_import():
    """Test API imports"""
    print("Testing API imports...")
    
    try:
        from prompt_synthesizer_api import prompt_synthesizer_bp
        print("✅ API imports: PASSED")
        return True
    except ImportError as e:
        print(f"❌ API imports: FAILED - {e}")
        return False
    except Exception as e:
        print(f"❌ API imports: FAILED - {e}")
        return False

def main():
    """Run all tests"""
    print("🧪 Running Prompt Synthesizer Tests\n")
    
    tests = [
        test_schema_validation,
        test_ai_provider_import,
        test_api_import
    ]
    
    passed = 0
    total = len(tests)
    
    for test in tests:
        if test():
            passed += 1
        print()
    
    print(f"📊 Test Results: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed! Prompt Synthesizer is ready.")
        return 0
    else:
        print("❌ Some tests failed. Please check the implementation.")
        return 1

if __name__ == "__main__":
    sys.exit(main())

