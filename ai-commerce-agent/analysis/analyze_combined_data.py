#!/usr/bin/env python3
"""
Comprehensive analysis of pre-test and post-test questionnaire data.
Uses the combined questionnaire and answer data for statistical analysis.
"""

import csv
import re
from pathlib import Path
from statistics import mean, median, stdev
from math import sqrt
from typing import Dict, List, Tuple, Optional

# Try to import optional libraries
try:
    import numpy as np
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False
    print("Note: pandas/numpy not available, using basic statistics")

try:
    from scipy import stats
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False
    print("Note: scipy not available, using basic t-test implementation")

try:
    import matplotlib.pyplot as plt
    import seaborn as sns
    HAS_MATPLOTLIB = True
    # Set style for better-looking plots
    try:
        plt.style.use('seaborn-v0_8-darkgrid')
    except:
        try:
            plt.style.use('seaborn-darkgrid')
        except:
            plt.style.use('default')
    try:
        sns.set_palette("husl")
    except:
        pass
except ImportError:
    HAS_MATPLOTLIB = False
    print("Note: matplotlib/seaborn not available, skipping visualizations")

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

def extract_numeric_responses(questions, responses):
    """Extract numeric (Likert scale) responses."""
    numeric_data = {}
    question_info = {}
    
    for q in questions:
        idx = q['index']
        answers = []
        
        for response in responses:
            if idx < len(response):
                val = response[idx].strip()
                try:
                    num = float(val)
                    if 0 <= num <= 5:  # Likert scale range
                        answers.append(num)
                except:
                    pass
        
        if answers:
            numeric_data[idx] = answers
            question_info[idx] = {
                'cleaned': q['cleaned'],
                'original': q['original'],
                'mean': mean(answers),
                'median': median(answers),
                'std': stdev(answers) if len(answers) > 1 else 0,
                'n': len(answers)
            }
    
    return numeric_data, question_info

def paired_t_test(pre_values, post_values):
    """Perform paired t-test."""
    if len(pre_values) != len(post_values):
        return None, None, None
    
    if HAS_SCIPY:
        t_stat, p_value = stats.ttest_rel(pre_values, post_values)
        return t_stat, p_value, p_value < 0.05
    else:
        # Manual calculation
        n = len(pre_values)
        differences = [post - pre for pre, post in zip(pre_values, post_values)]
        mean_diff = mean(differences)
        std_diff = stdev(differences) if n > 1 else 0
        
        if std_diff == 0:
            return 0, 1.0, False
        
        se = std_diff / sqrt(n)
        t_stat = mean_diff / se if se > 0 else 0
        
        # Approximate p-value (two-tailed)
        # For small samples, this is rough
        if abs(t_stat) > 2.447:  # t-critical for df=5, alpha=0.05
            p_value = 0.05
        elif abs(t_stat) > 1.943:  # t-critical for df=5, alpha=0.10
            p_value = 0.10
        else:
            p_value = 0.20
        
        return t_stat, p_value, p_value < 0.05

def analyze_question_mapping(pre_questions, post_questions):
    """Map pre-test and post-test questions that are related."""
    # Map based on question content similarity
    mappings = []
    
    # Key phrases to match
    key_phrases = [
        ('visually easy to identify', 'visually easy to identify'),
        ('mother language', 'mother language'),
        ('understand my preferences', 'understand my preferences'),
        ('invasion of privacy', 'not worried about'),
        ('unnecessary explanations', 'direct links without'),
        ('clear, concise explanation', 'clear, concise explanation'),
        ('price-friendly', 'price-friendly'),
        ('correct and suitable', 'correct and suitable'),
        ('improve my online shopping', 'helped improve my online shopping')
    ]
    
    for pre_q in pre_questions:
        pre_text = pre_q['cleaned'].lower()
        best_match = None
        best_score = 0
        
        for post_q in post_questions:
            post_text = post_q['cleaned'].lower()
            
            # Check for key phrase matches
            for pre_phrase, post_phrase in key_phrases:
                if pre_phrase in pre_text and post_phrase in post_text:
                    score = len(pre_phrase.split())
                    if score > best_score:
                        best_score = score
                        best_match = post_q
                        break
        
        if best_match:
            mappings.append({
                'pre': pre_q,
                'post': best_match,
                'type': 'matched'
            })
    
    return mappings

def create_comparison_analysis(pre_questions, pre_responses, post_questions, post_responses, output_dir):
    """Create comprehensive analysis comparing pre and post test."""
    output_dir = Path(output_dir)
    output_dir.mkdir(exist_ok=True)
    
    # Extract numeric responses
    pre_numeric, pre_info = extract_numeric_responses(pre_questions, pre_responses)
    post_numeric, post_info = extract_numeric_responses(post_questions, post_responses)
    
    # Find matching questions
    question_mappings = analyze_question_mapping(pre_questions, post_questions)
    
    # Create analysis report
    report_file = output_dir / 'detailed_analysis_report.txt'
    with open(report_file, 'w', encoding='utf-8') as f:
        f.write("=" * 100 + "\n")
        f.write("DETAILED STATISTICAL ANALYSIS REPORT\n")
        f.write("AI E-commerce Assistant Experience Evaluation\n")
        f.write("=" * 100 + "\n\n")
        
        f.write("DATA SUMMARY\n")
        f.write("-" * 100 + "\n")
        f.write(f"Pre-test: {len(pre_questions)} questions, {len(pre_responses)} participants\n")
        f.write(f"Post-test: {len(post_questions)} questions, {len(post_responses)} participants\n")
        f.write(f"Numeric questions (Likert scale): Pre={len(pre_numeric)}, Post={len(post_numeric)}\n\n")
        
        # Pre-test statistics
        f.write("PRE-TEST DESCRIPTIVE STATISTICS\n")
        f.write("-" * 100 + "\n")
        for idx, info in sorted(pre_info.items()):
            f.write(f"\nQ{idx}: {info['cleaned'][:60]}...\n")
            f.write(f"  Mean: {info['mean']:.2f}, Median: {info['median']:.2f}, Std: {info['std']:.2f}, N: {info['n']}\n")
        
        # Post-test statistics
        f.write("\n\nPOST-TEST DESCRIPTIVE STATISTICS\n")
        f.write("-" * 100 + "\n")
        for idx, info in sorted(post_info.items()):
            f.write(f"\nQ{idx}: {info['cleaned'][:60]}...\n")
            f.write(f"  Mean: {info['mean']:.2f}, Median: {info['median']:.2f}, Std: {info['std']:.2f}, N: {info['n']}\n")
        
        # Paired comparisons
        f.write("\n\nPAIRED COMPARISONS (Pre vs Post)\n")
        f.write("-" * 100 + "\n")
        
        if len(pre_responses) == len(post_responses) and question_mappings:
            f.write(f"\nFound {len(question_mappings)} matched question pairs\n\n")
            
            for mapping in question_mappings:
                pre_q = mapping['pre']
                post_q = mapping['post']
                pre_idx = pre_q['index']
                post_idx = post_q['index']
                
                if pre_idx in pre_numeric and post_idx in post_numeric:
                    pre_vals = pre_numeric[pre_idx]
                    post_vals = post_numeric[post_idx]
                    
                    # Match participants if possible
                    if len(pre_vals) == len(post_vals):
                        t_stat, p_value, significant = paired_t_test(pre_vals, post_vals)
                        
                        f.write(f"Question: {pre_q['cleaned'][:70]}...\n")
                        f.write(f"  Pre-test:  Mean={mean(pre_vals):.2f}, N={len(pre_vals)}\n")
                        f.write(f"  Post-test: Mean={mean(post_vals):.2f}, N={len(post_vals)}\n")
                        f.write(f"  Difference: {mean(post_vals) - mean(pre_vals):.2f}\n")
                        if t_stat is not None:
                            f.write(f"  Paired t-test: t={t_stat:.3f}, p={p_value:.4f}, Significant: {'Yes' if significant else 'No'}\n")
                        f.write("\n")
        
        # Overall comparison
        f.write("\n\nOVERALL COMPARISON\n")
        f.write("-" * 100 + "\n")
        
        all_pre_means = [info['mean'] for info in pre_info.values()]
        all_post_means = [info['mean'] for info in post_info.values()]
        
        if all_pre_means and all_post_means:
            overall_pre = mean(all_pre_means)
            overall_post = mean(all_post_means)
            
            f.write(f"Overall Mean Score:\n")
            f.write(f"  Pre-test:  {overall_pre:.2f}\n")
            f.write(f"  Post-test: {overall_post:.2f}\n")
            f.write(f"  Difference: {overall_post - overall_pre:.2f}\n")
            f.write(f"  Change: {((overall_post - overall_pre) / overall_pre * 100):.1f}%\n")
            
            # Paired t-test on overall means if same number of participants
            if len(pre_responses) == len(post_responses):
                pre_overall = [mean([pre_numeric.get(q['index'], [0])[i] if i < len(pre_numeric.get(q['index'], [])) else 0 
                                     for q in pre_questions if q['index'] in pre_numeric]) 
                              for i in range(len(pre_responses))]
                post_overall = [mean([post_numeric.get(q['index'], [0])[i] if i < len(post_numeric.get(q['index'], [])) else 0 
                                     for q in post_questions if q['index'] in post_numeric]) 
                               for i in range(len(post_responses))]
                
                t_stat, p_value, significant = paired_t_test(pre_overall, post_overall)
                if t_stat is not None:
                    f.write(f"\nPaired t-test (overall scores):\n")
                    f.write(f"  t-statistic: {t_stat:.3f}\n")
                    f.write(f"  p-value: {p_value:.4f}\n")
                    f.write(f"  Statistically significant: {'Yes' if significant else 'No'} (α=0.05)\n")
    
    print(f"✅ Saved detailed report: {report_file}")
    
    # Create visualizations if matplotlib is available
    if HAS_MATPLOTLIB and HAS_PANDAS:
        create_visualizations(pre_numeric, pre_info, post_numeric, post_info, 
                            question_mappings, pre_responses, post_responses, output_dir)

def create_visualizations(pre_numeric, pre_info, post_numeric, post_info, 
                         question_mappings, pre_responses, post_responses, output_dir):
    """Create visualization plots."""
    
    # 1. Overall mean comparison
    all_pre_means = [info['mean'] for info in pre_info.values()]
    all_post_means = [info['mean'] for info in post_info.values()]
    
    if all_pre_means and all_post_means:
        fig, ax = plt.subplots(figsize=(10, 6))
        overall_pre = mean(all_pre_means)
        overall_post = mean(all_post_means)
        
        categories = ['Pre-test', 'Post-test']
        means = [overall_pre, overall_post]
        colors = ['#3498db', '#e74c3c']
        
        bars = ax.bar(categories, means, color=colors, alpha=0.7, edgecolor='black', linewidth=1.5)
        ax.set_ylabel('Mean Score', fontsize=12, fontweight='bold')
        ax.set_title('Overall Mean Score Comparison: Pre-test vs Post-test', 
                    fontsize=14, fontweight='bold', pad=20)
        ax.set_ylim(0, max(means) * 1.2)
        
        for bar, mean_val in zip(bars, means):
            height = bar.get_height()
            ax.text(bar.get_x() + bar.get_width()/2., height,
                    f'{mean_val:.2f}',
                    ha='center', va='bottom', fontsize=11, fontweight='bold')
        
        plt.tight_layout()
        plt.savefig(output_dir / 'overall_comparison.png', dpi=300, bbox_inches='tight')
        print(f"✅ Saved: {output_dir / 'overall_comparison.png'}")
        plt.close()
    
    # 2. Individual question comparison (for matched questions)
    if question_mappings and len(pre_responses) == len(post_responses):
        matched_pairs = []
        for mapping in question_mappings:
            pre_q = mapping['pre']
            post_q = mapping['post']
            pre_idx = pre_q['index']
            post_idx = post_q['index']
            
            if pre_idx in pre_numeric and post_idx in post_numeric:
                pre_vals = pre_numeric[pre_idx]
                post_vals = post_numeric[post_idx]
                if len(pre_vals) == len(post_vals):
                    matched_pairs.append({
                        'question': pre_q['cleaned'][:50],
                        'pre_mean': mean(pre_vals),
                        'post_mean': mean(post_vals)
                    })
        
        if matched_pairs:
            fig, ax = plt.subplots(figsize=(12, max(6, len(matched_pairs) * 0.5)))
            
            questions = [p['question'] for p in matched_pairs]
            pre_means = [p['pre_mean'] for p in matched_pairs]
            post_means = [p['post_mean'] for p in matched_pairs]
            
            x = np.arange(len(questions))
            width = 0.35
            
            bars1 = ax.barh(x - width/2, pre_means, width, label='Pre-test', color='#3498db', alpha=0.7)
            bars2 = ax.barh(x + width/2, post_means, width, label='Post-test', color='#e74c3c', alpha=0.7)
            
            ax.set_xlabel('Mean Score', fontsize=12, fontweight='bold')
            ax.set_title('Question-by-Question Comparison: Pre-test vs Post-test', 
                        fontsize=14, fontweight='bold', pad=20)
            ax.set_yticks(x)
            ax.set_yticklabels(questions, fontsize=9)
            ax.legend()
            ax.set_xlim(0, 5.5)
            ax.grid(True, alpha=0.3, axis='x')
            
            plt.tight_layout()
            plt.savefig(output_dir / 'question_comparison.png', dpi=300, bbox_inches='tight')
            print(f"✅ Saved: {output_dir / 'question_comparison.png'}")
            plt.close()

def main():
    analysis_dir = Path(__file__).parent
    
    print("=" * 80)
    print("QUESTIONNAIRE DATA ANALYSIS")
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
    
    # Create analysis
    output_dir = analysis_dir / 'analysis_output'
    print(f"\nPerforming analysis...")
    create_comparison_analysis(pre_questions, pre_responses, post_questions, post_responses, output_dir)
    
    print("\n" + "=" * 80)
    print("✅ ANALYSIS COMPLETE!")
    print("=" * 80)
    print(f"\nOutput files saved to: {output_dir}/")
    print("  - detailed_analysis_report.txt")
    if HAS_MATPLOTLIB:
        print("  - overall_comparison.png")
        print("  - question_comparison.png")

if __name__ == '__main__':
    main()


