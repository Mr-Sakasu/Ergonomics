#!/usr/bin/env python3
"""
Extract questionnaire questions and answers from CSV files
and create a combined data structure.
"""

import csv
import json
import re
from pathlib import Path

def clean_question_text(text):
    """Clean and extract question text from CSV headers."""
    # Remove question numbers and special characters
    text = re.sub(r'^\d+[?;]', '', text)
    text = re.sub(r'^[?;]+', '', text)
    # Extract English text if available
    match = re.search(r'([A-Z][^?;]+)', text)
    if match:
        return match.group(1).strip()
    return text.strip()

def parse_csv_file(filepath):
    """Parse a CSV file and extract questions and answers."""
    questions = []
    responses = []
    
    # Try different encodings
    encodings = ['utf-8', 'gbk', 'gb2312', 'latin-1', 'cp1252']
    content = None
    encoding_used = None
    
    for enc in encodings:
        try:
            with open(filepath, 'r', encoding=enc) as f:
                content = f.read()
            encoding_used = enc
            break
        except UnicodeDecodeError:
            continue
    
    if content is None:
        raise ValueError(f"Could not decode file {filepath} with any encoding")
    
    lines = content.strip().split('\n')
    
    # Read first line as headers
    header_line = lines[0].strip()
    headers = header_line.split(';')
    
    # Extract questions from headers
    for i, header in enumerate(headers):
        if header and not header.startswith('??'):
            clean_q = clean_question_text(header)
            if clean_q:
                questions.append({
                    'index': i,
                    'original': header,
                    'cleaned': clean_q
                })
    
    # Read data rows
    for line in lines[1:]:
        if line.strip():
            row = line.split(';')
            if row and any(cell.strip() for cell in row):
                responses.append(row)
    
    return questions, responses

def main():
    analysis_dir = Path(__file__).parent
    
    # Parse pre-test data
    pre_file = analysis_dir / 'pre-test_Tsinghua University AI E-commerce Assistant_7_6(Sheet1).csv'
    pre_questions, pre_responses = parse_csv_file(pre_file)
    
    # Parse post-test data
    post_file = analysis_dir / 'pos-test_Tsinghua University - AI E-commerce Assistant Experience Evaluation_6_6(Sheet1).csv'
    post_questions, post_responses = parse_csv_file(post_file)
    
    # Create combined structure
    combined_data = {
        'metadata': {
            'pre_test_file': str(pre_file.name),
            'post_test_file': str(post_file.name),
            'num_pre_questions': len(pre_questions),
            'num_post_questions': len(post_questions),
            'num_pre_responses': len(pre_responses),
            'num_post_responses': len(post_responses)
        },
        'pre_test': {
            'questions': pre_questions,
            'responses': pre_responses
        },
        'post_test': {
            'questions': post_questions,
            'responses': post_responses
        }
    }
    
    # Save to JSON
    output_file = analysis_dir / 'questionnaire_data.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(combined_data, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Extracted data saved to: {output_file}")
    print(f"   Pre-test: {len(pre_questions)} questions, {len(pre_responses)} responses")
    print(f"   Post-test: {len(post_questions)} questions, {len(post_responses)} responses")
    
    # Also create a human-readable text file
    text_output = analysis_dir / 'questionnaire_combined.txt'
    with open(text_output, 'w', encoding='utf-8') as f:
        f.write("=" * 80 + "\n")
        f.write("PRE-TEST QUESTIONNAIRE\n")
        f.write("=" * 80 + "\n\n")
        
        for i, q in enumerate(pre_questions, 1):
            f.write(f"Q{i} (Index {q['index']}): {q['cleaned']}\n")
            f.write(f"   Original: {q['original']}\n\n")
        
        f.write("\n" + "=" * 80 + "\n")
        f.write("POST-TEST QUESTIONNAIRE\n")
        f.write("=" * 80 + "\n\n")
        
        for i, q in enumerate(post_questions, 1):
            f.write(f"Q{i} (Index {q['index']}): {q['cleaned']}\n")
            f.write(f"   Original: {q['original']}\n\n")
        
        f.write("\n" + "=" * 80 + "\n")
        f.write("RESPONSES SUMMARY\n")
        f.write("=" * 80 + "\n\n")
        f.write(f"Pre-test responses: {len(pre_responses)} participants\n")
        f.write(f"Post-test responses: {len(post_responses)} participants\n")
    
    print(f"✅ Human-readable format saved to: {text_output}")

if __name__ == '__main__':
    main()

