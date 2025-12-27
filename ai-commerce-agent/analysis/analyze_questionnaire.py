#!/usr/bin/env python3
"""
Analyze pre-test and post-test questionnaire data.
Performs statistical analysis and generates visualizations.
"""

import json
from pathlib import Path
from statistics import mean, median, stdev
from math import sqrt

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
        plt.style.use('default')
    try:
        sns.set_palette("husl")
    except:
        pass
except ImportError:
    HAS_MATPLOTLIB = False
    print("Note: matplotlib/seaborn not available, skipping visualizations")

def load_data(json_file):
    """Load questionnaire data from JSON file."""
    with open(json_file, 'r', encoding='utf-8') as f:
        return json.load(f)

def extract_numeric_responses(data, test_type='pre_test'):
    """Extract numeric responses from questionnaire data."""
    responses = data[test_type]['responses']
    questions = data[test_type]['questions']
    
    # Convert responses to DataFrame
    df = pd.DataFrame(responses)
    
    # Identify Likert scale questions (expecting numeric values 1-5)
    numeric_cols = []
    question_mapping = {}
    
    for q in questions:
        idx = q['index']
        if idx < len(df.columns):
            # Try to convert to numeric
            try:
                col_data = pd.to_numeric(df.iloc[:, idx], errors='coerce')
                if col_data.notna().any():
                    # Check if values are in typical Likert scale range
                    unique_vals = col_data.dropna().unique()
                    if len(unique_vals) > 0 and all(v in [0, 1, 2, 3, 4, 5] for v in unique_vals if not np.isnan(v)):
                        numeric_cols.append(idx)
                        question_mapping[idx] = {
                            'cleaned': q['cleaned'],
                            'original': q['original']
                        }
            except:
                pass
    
    # Extract numeric columns
    numeric_df = df.iloc[:, numeric_cols].apply(pd.to_numeric, errors='coerce')
    numeric_df.columns = [f"Q{question_mapping[col]['cleaned'][:30]}" for col in numeric_cols]
    
    return numeric_df, question_mapping

def descriptive_statistics(df, label=""):
    """Calculate descriptive statistics."""
    stats_dict = {
        'mean': df.mean(),
        'median': df.median(),
        'std': df.std(),
        'min': df.min(),
        'max': df.max(),
        'count': df.count()
    }
    
    stats_df = pd.DataFrame(stats_dict).T
    print(f"\n{'='*80}")
    print(f"DESCRIPTIVE STATISTICS - {label}")
    print(f"{'='*80}")
    print(stats_df.round(2))
    return stats_df

def compare_pre_post(pre_df, post_df, question_mapping_pre, question_mapping_post):
    """Compare pre-test and post-test responses."""
    print(f"\n{'='*80}")
    print("PRE-POST COMPARISON")
    print(f"{'='*80}")
    
    # Find matching questions (based on similar text patterns)
    # For now, we'll compare questions that appear in both
    # In a real scenario, you'd want to map specific questions
    
    # Get common numeric columns
    pre_numeric = pre_df.select_dtypes(include=[np.number])
    post_numeric = post_df.select_dtypes(include=[np.number])
    
    # If we have the same number of participants, do paired comparisons
    if len(pre_numeric) == len(post_numeric) and len(pre_numeric) > 0:
        print(f"\nNumber of participants: {len(pre_numeric)}")
        
        # Compare means for each question
        comparisons = []
        
        # Compare overall means
        pre_mean = pre_numeric.mean().mean()
        post_mean = post_numeric.mean().mean()
        
        print(f"\nOverall Mean Scores:")
        print(f"  Pre-test:  {pre_mean:.2f}")
        print(f"  Post-test: {post_mean:.2f}")
        print(f"  Difference: {post_mean - pre_mean:.2f}")
        
        # Paired t-test on overall means
        if len(pre_numeric) > 1:
            pre_overall = pre_numeric.mean(axis=1)
            post_overall = post_numeric.mean(axis=1)
            
            t_stat, p_value = stats.ttest_rel(pre_overall, post_overall)
            print(f"\nPaired t-test (overall scores):")
            print(f"  t-statistic: {t_stat:.3f}")
            print(f"  p-value: {p_value:.3f}")
            print(f"  Significant: {'Yes' if p_value < 0.05 else 'No'} (α=0.05)")
        
        return {
            'pre_mean': pre_mean,
            'post_mean': post_mean,
            'difference': post_mean - pre_mean,
            't_stat': t_stat if len(pre_numeric) > 1 else None,
            'p_value': p_value if len(pre_numeric) > 1 else None
        }
    
    return None

def create_visualizations(pre_df, post_df, output_dir):
    """Create visualization plots."""
    output_dir = Path(output_dir)
    output_dir.mkdir(exist_ok=True)
    
    pre_numeric = pre_df.select_dtypes(include=[np.number])
    post_numeric = post_df.select_dtypes(include=[np.number])
    
    # 1. Overall mean comparison
    fig, ax = plt.subplots(figsize=(10, 6))
    pre_mean = pre_numeric.mean().mean()
    post_mean = post_numeric.mean().mean()
    
    categories = ['Pre-test', 'Post-test']
    means = [pre_mean, post_mean]
    colors = ['#3498db', '#e74c3c']
    
    bars = ax.bar(categories, means, color=colors, alpha=0.7, edgecolor='black', linewidth=1.5)
    ax.set_ylabel('Mean Score', fontsize=12, fontweight='bold')
    ax.set_title('Overall Mean Score Comparison: Pre-test vs Post-test', 
                 fontsize=14, fontweight='bold', pad=20)
    ax.set_ylim(0, max(means) * 1.2)
    
    # Add value labels on bars
    for bar, mean in zip(bars, means):
        height = bar.get_height()
        ax.text(bar.get_x() + bar.get_width()/2., height,
                f'{mean:.2f}',
                ha='center', va='bottom', fontsize=11, fontweight='bold')
    
    plt.tight_layout()
    plt.savefig(output_dir / 'overall_comparison.png', dpi=300, bbox_inches='tight')
    print(f"\n✅ Saved: {output_dir / 'overall_comparison.png'}")
    plt.close()
    
    # 2. Distribution comparison
    if len(pre_numeric) > 0 and len(post_numeric) > 0:
        fig, axes = plt.subplots(1, 2, figsize=(14, 6))
        
        pre_overall = pre_numeric.mean(axis=1)
        post_overall = post_numeric.mean(axis=1)
        
        axes[0].hist(pre_overall, bins=10, color='#3498db', alpha=0.7, edgecolor='black')
        axes[0].set_title('Pre-test Score Distribution', fontsize=12, fontweight='bold')
        axes[0].set_xlabel('Mean Score', fontsize=10)
        axes[0].set_ylabel('Frequency', fontsize=10)
        axes[0].axvline(pre_overall.mean(), color='red', linestyle='--', 
                       linewidth=2, label=f'Mean: {pre_overall.mean():.2f}')
        axes[0].legend()
        
        axes[1].hist(post_overall, bins=10, color='#e74c3c', alpha=0.7, edgecolor='black')
        axes[1].set_title('Post-test Score Distribution', fontsize=12, fontweight='bold')
        axes[1].set_xlabel('Mean Score', fontsize=10)
        axes[1].set_ylabel('Frequency', fontsize=10)
        axes[1].axvline(post_overall.mean(), color='red', linestyle='--', 
                       linewidth=2, label=f'Mean: {post_overall.mean():.2f}')
        axes[1].legend()
        
        plt.tight_layout()
        plt.savefig(output_dir / 'score_distributions.png', dpi=300, bbox_inches='tight')
        print(f"✅ Saved: {output_dir / 'score_distributions.png'}")
        plt.close()
    
    # 3. Box plot comparison
    if len(pre_numeric) > 0 and len(post_numeric) > 0:
        fig, ax = plt.subplots(figsize=(10, 6))
        
        data_to_plot = [pre_overall, post_overall]
        bp = ax.boxplot(data_to_plot, labels=['Pre-test', 'Post-test'], 
                       patch_artist=True, widths=0.6)
        
        colors_box = ['#3498db', '#e74c3c']
        for patch, color in zip(bp['boxes'], colors_box):
            patch.set_facecolor(color)
            patch.set_alpha(0.7)
        
        ax.set_ylabel('Mean Score', fontsize=12, fontweight='bold')
        ax.set_title('Score Distribution Comparison: Pre-test vs Post-test', 
                    fontsize=14, fontweight='bold', pad=20)
        ax.grid(True, alpha=0.3, axis='y')
        
        plt.tight_layout()
        plt.savefig(output_dir / 'boxplot_comparison.png', dpi=300, bbox_inches='tight')
        print(f"✅ Saved: {output_dir / 'boxplot_comparison.png'}")
        plt.close()

def generate_report(data, pre_df, post_df, comparison_results, output_dir):
    """Generate a text report of the analysis."""
    output_dir = Path(output_dir)
    output_file = output_dir / 'analysis_report.txt'
    
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write("=" * 80 + "\n")
        f.write("QUESTIONNAIRE ANALYSIS REPORT\n")
        f.write("=" * 80 + "\n\n")
        
        f.write("DATA SUMMARY\n")
        f.write("-" * 80 + "\n")
        f.write(f"Pre-test participants: {len(pre_df)}\n")
        f.write(f"Post-test participants: {len(post_df)}\n")
        f.write(f"Pre-test questions: {data['metadata']['num_pre_questions']}\n")
        f.write(f"Post-test questions: {data['metadata']['num_post_questions']}\n\n")
        
        f.write("DESCRIPTIVE STATISTICS\n")
        f.write("-" * 80 + "\n")
        f.write("\nPre-test:\n")
        f.write(f"  Mean: {pre_df.select_dtypes(include=[np.number]).mean().mean():.2f}\n")
        f.write(f"  Median: {pre_df.select_dtypes(include=[np.number]).median().median():.2f}\n")
        f.write(f"  Std Dev: {pre_df.select_dtypes(include=[np.number]).std().mean():.2f}\n")
        
        f.write("\nPost-test:\n")
        f.write(f"  Mean: {post_df.select_dtypes(include=[np.number]).mean().mean():.2f}\n")
        f.write(f"  Median: {post_df.select_dtypes(include=[np.number]).median().median():.2f}\n")
        f.write(f"  Std Dev: {post_df.select_dtypes(include=[np.number]).std().mean():.2f}\n")
        
        if comparison_results:
            f.write("\nCOMPARISON RESULTS\n")
            f.write("-" * 80 + "\n")
            f.write(f"Pre-test mean: {comparison_results['pre_mean']:.2f}\n")
            f.write(f"Post-test mean: {comparison_results['post_mean']:.2f}\n")
            f.write(f"Difference: {comparison_results['difference']:.2f}\n")
            if comparison_results['p_value'] is not None:
                f.write(f"Paired t-test p-value: {comparison_results['p_value']:.4f}\n")
                f.write(f"Statistically significant: {'Yes' if comparison_results['p_value'] < 0.05 else 'No'} (α=0.05)\n")
    
    print(f"✅ Saved: {output_file}")

def main():
    analysis_dir = Path(__file__).parent
    json_file = analysis_dir / 'questionnaire_data.json'
    
    if not json_file.exists():
        print(f"❌ Error: {json_file} not found. Please run extract_questionnaire_data.py first.")
        return
    
    print("Loading questionnaire data...")
    data = load_data(json_file)
    
    print("Extracting numeric responses...")
    pre_df, question_mapping_pre = extract_numeric_responses(data, 'pre_test')
    post_df, question_mapping_post = extract_numeric_responses(data, 'post_test')
    
    print("\n" + "="*80)
    print("ANALYSIS RESULTS")
    print("="*80)
    
    # Descriptive statistics
    descriptive_statistics(pre_df, "PRE-TEST")
    descriptive_statistics(post_df, "POST-TEST")
    
    # Comparison
    comparison_results = compare_pre_post(pre_df, post_df, question_mapping_pre, question_mapping_post)
    
    # Create visualizations
    print("\n" + "="*80)
    print("GENERATING VISUALIZATIONS")
    print("="*80)
    output_dir = analysis_dir / 'analysis_output'
    create_visualizations(pre_df, post_df, output_dir)
    
    # Generate report
    print("\n" + "="*80)
    print("GENERATING REPORT")
    print("="*80)
    generate_report(data, pre_df, post_df, comparison_results, output_dir)
    
    print("\n" + "="*80)
    print("✅ ANALYSIS COMPLETE!")
    print("="*80)
    print(f"\nOutput files saved to: {output_dir}/")
    print("  - overall_comparison.png")
    print("  - score_distributions.png")
    print("  - boxplot_comparison.png")
    print("  - analysis_report.txt")

if __name__ == '__main__':
    main()

