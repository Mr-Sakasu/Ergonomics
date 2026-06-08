#!/usr/bin/env python3
"""
Compare responses between Chinese speakers and English speakers
based on cultural background.
"""

import csv
import re
from pathlib import Path
from statistics import mean, median, stdev
from typing import Dict, List, Tuple

def clean_question_text(text):
    """Clean and extract question text from CSV headers."""
    text = re.sub(r'^\d+[?;]', '', text)
    text = re.sub(r'^[?;]+', '', text)
    match = re.search(r'([A-Z][^?;]+)', text)
    if match:
        return match.group(1).strip()
    return text.strip()

def parse_csv_file(filepath):
    """Parse a CSV file and extract questions and answers."""
    questions = []
    responses = []

    encodings = ['utf-8', 'gbk', 'gb2312', 'latin-1', 'cp1252']
    content = None

    for enc in encodings:
        try:
            with open(filepath, 'r', encoding=enc) as f:
                content = f.read()
            break
        except UnicodeDecodeError:
            continue

    if content is None:
        raise ValueError(f"Could not decode file {filepath} with any encoding")

    lines = content.strip().split('\n')
    header_line = lines[0].strip()
    headers = header_line.split(';')

    for i, header in enumerate(headers):
        if header and not header.startswith('??'):
            clean_q = clean_question_text(header)
            if clean_q:
                questions.append({
                    'index': i,
                    'original': header,
                    'cleaned': clean_q
                })

    for line in lines[1:]:
        if line.strip():
            row = line.split(';')
            if row and any(cell.strip() for cell in row):
                responses.append(row)

    return questions, responses

def get_cultural_background(responses, cultural_bg_index=7):
    """Extract cultural background for each participant."""
    groups = {'chinese': [], 'english': []}

    for idx, response in enumerate(responses, 1):
        if cultural_bg_index < len(response):
            bg = response[cultural_bg_index].strip()
            # Assuming 1 = Chinese, 2 = English/Western
            if bg == '1':
                groups['chinese'].append(idx)
            elif bg == '2':
                groups['english'].append(idx)

    return groups

def extract_numeric_responses_by_group(questions, responses, group_indices, start_question_idx=25):
    """Extract numeric responses for a specific group."""
    numeric_data = {}

    for q in questions:
        idx = q['index']
        if idx < start_question_idx:  # Skip demographic questions
            continue

        answers = []
        for participant_idx in group_indices:
            participant_num = participant_idx - 1  # Convert to 0-based
            if participant_num < len(responses) and idx < len(responses[participant_num]):
                val = responses[participant_num][idx].strip()
                try:
                    num = float(val)
                    if 0 <= num <= 5:  # Likert scale range
                        answers.append(num)
                except:
                    pass

        if answers:
            numeric_data[idx] = {
                'question': q['cleaned'],
                'answers': answers,
                'mean': mean(answers),
                'median': median(answers),
                'std': stdev(answers) if len(answers) > 1 else 0,
                'n': len(answers)
            }

    return numeric_data

def compare_groups(chinese_data, english_data, output_file):
    """Compare Chinese and English speaker groups."""

    with open(output_file, 'w', encoding='utf-8') as f:
        f.write("=" * 100 + "\n")
        f.write("LANGUAGE GROUP COMPARISON ANALYSIS\n")
        f.write("Chinese Speakers vs English Speakers\n")
        f.write("=" * 100 + "\n\n")

        # Group sizes
        chinese_n = len(chinese_data.get(list(chinese_data.keys())[0] if chinese_data else [])['answers']) if chinese_data else 0
        english_n = len(english_data.get(list(english_data.keys())[0] if english_data else [])['answers']) if english_data else 0

        f.write("GROUP SIZES\n")
        f.write("-" * 100 + "\n")
        f.write(f"Chinese speakers: {chinese_n} participants\n")
        f.write(f"English speakers: {english_n} participants\n\n")

        # Find common questions
        common_questions = set(chinese_data.keys()) & set(english_data.keys())

        f.write("=" * 100 + "\n")
        f.write("PRE-TEST EXPECTATIONS COMPARISON\n")
        f.write("=" * 100 + "\n\n")

        comparisons = []
        for q_idx in sorted(common_questions):
            ch_q = chinese_data[q_idx]
            en_q = english_data[q_idx]

            diff = ch_q['mean'] - en_q['mean']
            comparisons.append({
                'question': ch_q['question'],
                'chinese_mean': ch_q['mean'],
                'english_mean': en_q['mean'],
                'difference': diff
            })

            f.write(f"Question: {ch_q['question'][:70]}...\n")
            f.write(f"  Chinese speakers: Mean={ch_q['mean']:.2f}, N={ch_q['n']}, Std={ch_q['std']:.2f}\n")
            f.write(f"  English speakers: Mean={en_q['mean']:.2f}, N={en_q['n']}, Std={en_q['std']:.2f}\n")
            f.write(f"  Difference: {diff:+.2f} ({'Chinese higher' if diff > 0 else 'English higher' if diff < 0 else 'Equal'})\n\n")

        # Overall comparison
        if comparisons:
            ch_overall = mean([c['chinese_mean'] for c in comparisons])
            en_overall = mean([c['english_mean'] for c in comparisons])

            f.write("=" * 100 + "\n")
            f.write("OVERALL PRE-TEST COMPARISON\n")
            f.write("-" * 100 + "\n")
            f.write(f"Chinese speakers overall mean: {ch_overall:.2f}\n")
            f.write(f"English speakers overall mean: {en_overall:.2f}\n")
            f.write(f"Difference: {ch_overall - en_overall:+.2f}\n\n")

def analyze_post_test(pre_questions, pre_responses, post_questions, post_responses, output_file):
    """Analyze post-test comparison."""
    # Get cultural background groups from pre-test
    groups = get_cultural_background(pre_responses)

    # Extract post-test numeric responses by group
    chinese_post = extract_numeric_responses_by_group(
        post_questions, post_responses, groups['chinese'], start_question_idx=13
    )
    english_post = extract_numeric_responses_by_group(
        post_questions, post_responses, groups['english'], start_question_idx=13
    )

    with open(output_file, 'a', encoding='utf-8') as f:
        f.write("\n" + "=" * 100 + "\n")
        f.write("POST-TEST EXPERIENCE COMPARISON\n")
        f.write("=" * 100 + "\n\n")

        common_questions = set(chinese_post.keys()) & set(english_post.keys())

        for q_idx in sorted(common_questions):
            ch_q = chinese_post[q_idx]
            en_q = english_post[q_idx]

            diff = ch_q['mean'] - en_q['mean']

            f.write(f"Question: {ch_q['question'][:70]}...\n")
            f.write(f"  Chinese speakers: Mean={ch_q['mean']:.2f}, N={ch_q['n']}, Std={ch_q['std']:.2f}\n")
            f.write(f"  English speakers: Mean={en_q['mean']:.2f}, N={en_q['n']}, Std={en_q['std']:.2f}\n")
            f.write(f"  Difference: {diff:+.2f} ({'Chinese higher' if diff > 0 else 'English higher' if diff < 0 else 'Equal'})\n\n")

        # Overall post-test comparison
        if common_questions:
            ch_overall = mean([chinese_post[q]['mean'] for q in common_questions])
            en_overall = mean([english_post[q]['mean'] for q in common_questions])

            f.write("=" * 100 + "\n")
            f.write("OVERALL POST-TEST COMPARISON\n")
            f.write("-" * 100 + "\n")
            f.write(f"Chinese speakers overall mean: {ch_overall:.2f}\n")
            f.write(f"English speakers overall mean: {en_overall:.2f}\n")
            f.write(f"Difference: {ch_overall - en_overall:+.2f}\n\n")

        # Pre-post improvement by group
        f.write("=" * 100 + "\n")
        f.write("PRE-POST IMPROVEMENT BY LANGUAGE GROUP\n")
        f.write("-" * 100 + "\n")

        # Calculate pre-test overall for each group
        chinese_pre = extract_numeric_responses_by_group(
            pre_questions, pre_responses, groups['chinese'], start_question_idx=25
        )
        english_pre = extract_numeric_responses_by_group(
            pre_questions, pre_responses, groups['english'], start_question_idx=25
        )

        if chinese_pre and chinese_post:
            ch_pre_mean = mean([chinese_pre[q]['mean'] for q in chinese_pre.keys() if q >= 25])
            ch_post_mean = mean([chinese_post[q]['mean'] for q in chinese_post.keys()])
            ch_improvement = ch_post_mean - ch_pre_mean

            f.write(f"Chinese speakers:\n")
            f.write(f"  Pre-test mean: {ch_pre_mean:.2f}\n")
            f.write(f"  Post-test mean: {ch_post_mean:.2f}\n")
            f.write(f"  Improvement: {ch_improvement:+.2f} ({ch_improvement/ch_pre_mean*100:+.1f}%)\n\n")

        if english_pre and english_post:
            en_pre_mean = mean([english_pre[q]['mean'] for q in english_pre.keys() if q >= 25])
            en_post_mean = mean([english_post[q]['mean'] for q in english_post.keys()])
            en_improvement = en_post_mean - en_pre_mean

            f.write(f"English speakers:\n")
            f.write(f"  Pre-test mean: {en_pre_mean:.2f}\n")
            f.write(f"  Post-test mean: {en_post_mean:.2f}\n")
            f.write(f"  Improvement: {en_improvement:+.2f} ({en_improvement/en_pre_mean*100:+.1f}%)\n\n")

def main():
    analysis_dir = Path(__file__).parent

    print("=" * 80)
    print("LANGUAGE GROUP COMPARISON ANALYSIS")
    print("=" * 80)

    # Parse pre-test data
    pre_file = analysis_dir / 'pre-test_Tsinghua University AI E-commerce Assistant_7_6(Sheet1).csv'
    print(f"\nLoading pre-test data: {pre_file.name}")
    pre_questions, pre_responses = parse_csv_file(pre_file)
    print(f"  ✓ {len(pre_questions)} questions, {len(pre_responses)} participants")

    # Parse post-test data
    post_file = analysis_dir / 'pos-test_Tsinghua University - AI E-commerce Assistant Experience Evaluation_6_6(Sheet1).csv'
    print(f"Loading post-test data: {post_file.name}")
    post_questions, post_responses = parse_csv_file(post_file)
    print(f"  ✓ {len(post_questions)} questions, {len(post_responses)} participants")

    # Get cultural background groups
    groups = get_cultural_background(pre_responses)
    print(f"\nGroup distribution:")
    print(f"  Chinese speakers (Cultural Background=1): {len(groups['chinese'])} participants")
    print(f"  English speakers (Cultural Background=2): {len(groups['english'])} participants")

    # Extract numeric responses by group (pre-test expectations, starting from Q25)
    chinese_pre = extract_numeric_responses_by_group(
        pre_questions, pre_responses, groups['chinese'], start_question_idx=25
    )
    english_pre = extract_numeric_responses_by_group(
        pre_questions, pre_responses, groups['english'], start_question_idx=25
    )

    # Create comparison analysis
    output_file = analysis_dir / 'analysis_output' / 'language_comparison_analysis.txt'
    output_file.parent.mkdir(exist_ok=True)

    print(f"\nPerforming comparison analysis...")
    compare_groups(chinese_pre, english_pre, output_file)
    analyze_post_test(pre_questions, pre_responses, post_questions, post_responses, output_file)

    print(f"\n✅ Analysis complete!")
    print(f"   Results saved to: {output_file}")

if __name__ == '__main__':
    main()
