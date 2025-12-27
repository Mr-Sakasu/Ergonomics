#!/usr/bin/env python3
"""
Combine questionnaire questions from docx/CSV with participant answers
from pre-test and post-test data files.
Creates a comprehensive file showing questions with all participant responses.
"""

import csv
import re
from pathlib import Path
from typing import Dict, List, Tuple

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
    
    return questions, responses, encoding_used

def extract_docx_questions(docx_path):
    """Try to extract questions from docx file if python-docx is available."""
    try:
        from docx import Document
        doc = Document(docx_path)
        questions = []
        for para in doc.paragraphs:
            text = para.text.strip()
            if text and ('?' in text or any(keyword in text.lower() for keyword in ['question', 'q1', 'q2', 'expectation'])):
                questions.append(text)
        return questions
    except ImportError:
        return None
    except Exception as e:
        print(f"Warning: Could not extract from docx: {e}")
        return None

def create_combined_file(pre_questions, pre_responses, post_questions, post_responses, output_file):
    """Create a comprehensive file combining questions with all participant answers."""
    
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write("=" * 100 + "\n")
        f.write("QUESTIONNAIRE WITH PARTICIPANT ANSWERS\n")
        f.write("AI E-commerce Assistant Experience Evaluation\n")
        f.write("=" * 100 + "\n\n")
        
        # PRE-TEST SECTION
        f.write("=" * 100 + "\n")
        f.write("PRE-TEST QUESTIONNAIRE\n")
        f.write("=" * 100 + "\n\n")
        
        for q_idx, question in enumerate(pre_questions, 1):
            idx = question['index']
            f.write(f"Q{q_idx} (Column {idx}): {question['cleaned']}\n")
            f.write(f"   Original: {question['original']}\n")
            f.write(f"\n   Participant Answers:\n")
            
            # Show answers from each participant
            for p_idx, response in enumerate(pre_responses, 1):
                if idx < len(response):
                    answer = response[idx].strip()
                    f.write(f"      Participant {p_idx}: {answer}\n")
                else:
                    f.write(f"      Participant {p_idx}: [No answer]\n")
            
            # Calculate statistics if numeric
            try:
                answers = [r[idx].strip() for r in pre_responses if idx < len(r) and r[idx].strip()]
                numeric_answers = []
                for a in answers:
                    try:
                        num = float(a)
                        numeric_answers.append(num)
                    except:
                        pass
                
                if numeric_answers:
                    avg = sum(numeric_answers) / len(numeric_answers)
                    f.write(f"\n   Statistics: Mean = {avg:.2f}, N = {len(numeric_answers)}\n")
            except:
                pass
            
            f.write("\n" + "-" * 100 + "\n\n")
        
        # POST-TEST SECTION
        f.write("\n" + "=" * 100 + "\n")
        f.write("POST-TEST QUESTIONNAIRE\n")
        f.write("=" * 100 + "\n\n")
        
        for q_idx, question in enumerate(post_questions, 1):
            idx = question['index']
            f.write(f"Q{q_idx} (Column {idx}): {question['cleaned']}\n")
            f.write(f"   Original: {question['original']}\n")
            f.write(f"\n   Participant Answers:\n")
            
            # Show answers from each participant
            for p_idx, response in enumerate(post_responses, 1):
                if idx < len(response):
                    answer = response[idx].strip()
                    f.write(f"      Participant {p_idx}: {answer}\n")
                else:
                    f.write(f"      Participant {p_idx}: [No answer]\n")
            
            # Calculate statistics if numeric
            try:
                answers = [r[idx].strip() for r in post_responses if idx < len(r) and r[idx].strip()]
                numeric_answers = []
                for a in answers:
                    try:
                        num = float(a)
                        numeric_answers.append(num)
                    except:
                        pass
                
                if numeric_answers:
                    avg = sum(numeric_answers) / len(numeric_answers)
                    f.write(f"\n   Statistics: Mean = {avg:.2f}, N = {len(numeric_answers)}\n")
            except:
                pass
            
            f.write("\n" + "-" * 100 + "\n\n")
        
        # SUMMARY SECTION
        f.write("\n" + "=" * 100 + "\n")
        f.write("SUMMARY\n")
        f.write("=" * 100 + "\n\n")
        f.write(f"Pre-test: {len(pre_questions)} questions, {len(pre_responses)} participants\n")
        f.write(f"Post-test: {len(post_questions)} questions, {len(post_responses)} participants\n")
        
        # Participant matching (if same number)
        if len(pre_responses) == len(post_responses):
            f.write(f"\nNote: {len(pre_responses)} participants completed both pre and post tests.\n")
            f.write("Participants can be matched for paired analysis.\n")

def main():
    analysis_dir = Path(__file__).parent
    
    # Parse pre-test data
    pre_file = analysis_dir / 'pre-test_Tsinghua University AI E-commerce Assistant_7_6(Sheet1).csv'
    print(f"Reading pre-test data from: {pre_file.name}")
    pre_questions, pre_responses, pre_enc = parse_csv_file(pre_file)
    print(f"  Found {len(pre_questions)} questions, {len(pre_responses)} participants")
    
    # Parse post-test data
    post_file = analysis_dir / 'pos-test_Tsinghua University - AI E-commerce Assistant Experience Evaluation_6_6(Sheet1).csv'
    print(f"Reading post-test data from: {post_file.name}")
    post_questions, post_responses, post_enc = parse_csv_file(post_file)
    print(f"  Found {len(post_questions)} questions, {len(post_responses)} participants")
    
    # Try to extract from docx if available
    docx_file = analysis_dir / 'Ergo_DATA_Ecommerce_Assistant_graphs.docx'
    docx_questions = None
    if docx_file.exists():
        print(f"\nAttempting to extract questions from: {docx_file.name}")
        docx_questions = extract_docx_questions(docx_file)
        if docx_questions:
            print(f"  Extracted {len(docx_questions)} potential questions from docx")
        else:
            print("  Could not extract from docx (python-docx may not be installed)")
    
    # Create combined file
    output_file = analysis_dir / 'questionnaire_with_answers.txt'
    print(f"\nCreating combined file: {output_file.name}")
    create_combined_file(pre_questions, pre_responses, post_questions, post_responses, output_file)
    
    print(f"\n✅ Successfully created: {output_file}")
    print(f"   This file contains all questions with participant answers")
    print(f"   Use this file for reference and the analysis scripts for statistical analysis")

if __name__ == '__main__':
    main()


