#!/usr/bin/env python3
"""
Create modern, professional graphs for specific questionnaire questions.
Based on actual questionnaire format from screenshots.

UPDATED:
- All graphs now use a blue-based gradient color scheme that automatically
  changes by values (count / percentage).
"""

import csv
import re
from pathlib import Path
from collections import Counter

try:
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches
    import matplotlib.colors as mcolors
    import numpy as np
    from matplotlib import style
    HAS_MATPLOTLIB = True
except ImportError:
    HAS_MATPLOTLIB = False
    print("Error: matplotlib is required. Install with: pip install matplotlib numpy")
    exit(1)


def setup_modern_style():
    """Set up modern matplotlib style."""
    plt.style.use('default')
    plt.rcParams.update({
        'font.family': 'sans-serif',
        'font.sans-serif': ['DejaVu Sans', 'Arial', 'Helvetica', 'Liberation Sans'],
        'font.size': 11,
        'axes.labelsize': 12,
        'axes.titlesize': 15,
        'axes.labelweight': '600',
        'axes.titleweight': '700',
        'xtick.labelsize': 10,
        'ytick.labelsize': 10,
        'legend.fontsize': 10,
        'figure.titlesize': 16,
        'axes.spines.top': False,
        'axes.spines.right': False,
        'axes.grid': True,
        'grid.alpha': 0.3,
        'grid.linewidth': 0.5,
        'grid.linestyle': '--',
    })


def blue_gradient_by_value(values, cmap_name='Blues', low=0.30, high=0.90, reverse=False):
    """
    Create blue-based gradient colors from values.
    - Larger value => darker blue (default).
    - Smaller value => lighter blue.
    - If reverse=True, direction is reversed.

    low/high: limit the colormap range to avoid too-white or too-dark extremes.
    """
    arr = np.asarray(values, dtype=float)
    if arr.size == 0:
        return []

    cmap = plt.get_cmap(cmap_name)

    vmin = np.nanmin(arr)
    vmax = np.nanmax(arr)

    # If all values are the same (e.g., all 0), return a single mid color
    if np.isclose(vmax, vmin):
        t = (low + high) / 2.0
        return [mcolors.to_hex(cmap(t))] * len(arr)

    norm = mcolors.Normalize(vmin=vmin, vmax=vmax)

    if reverse:
        ts = high - (high - low) * norm(arr)
    else:
        ts = low + (high - low) * norm(arr)

    return [mcolors.to_hex(cmap(float(t))) for t in ts]


def parse_csv_file(filepath):
    """Parse a CSV file and extract responses."""
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
        raise ValueError(f"Could not decode file {filepath}")

    lines = content.strip().split('\n')
    header_line = lines[0].strip()
    headers = header_line.split(';')

    responses = []
    for line in lines[1:]:
        if line.strip():
            row = line.split(';')
            if row and any(cell.strip() for cell in row):
                responses.append(row)

    return headers, responses


def graph1_ai_usage_frequency(headers, responses, output_dir):
    """Graph 1: How often is generative AI tools used? (Bar chart)"""
    col_idx = 14

    frequency_labels = {
        '1': 'Multiple times\na day',
        '2': 'Few times\na day',
        '3': 'Multiple times\na week',
        '4': 'Few times\na week',
        '5': 'Multiple times\na month',
        '6': 'Few times\na month',
        '7': 'Barely use\nAI assistant'
    }

    values = []
    for response in responses:
        if col_idx < len(response):
            val = response[col_idx].strip()
            if val:
                values.append(val)

    counter = Counter(values)

    # Show all 7 options (even if some are 0)
    labels = []
    counts = []
    for key in ['1', '2', '3', '4', '5', '6', '7']:
        labels.append(frequency_labels.get(key, f'Option {key}'))
        counts.append(counter.get(key, 0))

    # Value-based blue gradient
    colors_list = blue_gradient_by_value(counts, low=0.30, high=0.90)

    fig, ax = plt.subplots(figsize=(12, 7))
    fig.patch.set_facecolor('white')

    bars = ax.bar(labels, counts, color=colors_list,
                  edgecolor='white', linewidth=2.5,
                  alpha=0.9)

    for bar, count in zip(bars, counts):
        height = bar.get_height()
        ax.text(bar.get_x() + bar.get_width()/2., height + 0.1,
                f'{int(count)}',
                ha='center', va='bottom',
                fontsize=13, fontweight='700',
                color='#1e293b')

    ax.set_xlabel('Usage Frequency', fontsize=13, fontweight='600', color='#374151', labelpad=12)
    ax.set_ylabel('Number of Participants', fontsize=13, fontweight='600', color='#374151', labelpad=12)
    ax.set_title('How Often Do You Use Generative AI Tools\nin Your Daily Life?',
                 fontsize=16, fontweight='700', color='#111827', pad=25)

    ax.set_ylim(0, max(counts) * 1.4 if counts else 1)
    max_y = int(max(counts) * 1.4) if counts else 1
    ax.set_yticks(np.arange(0, max_y + 1, 1))
    ax.grid(True, alpha=0.2, linestyle='--', linewidth=0.8, axis='y')
    ax.set_axisbelow(True)

    plt.xticks(rotation=0, ha='center', fontsize=10, color='#4b5563')
    ax.spines['bottom'].set_color('#e5e7eb')
    ax.spines['left'].set_color('#e5e7eb')
    ax.spines['bottom'].set_linewidth(1.5)
    ax.spines['left'].set_linewidth(1.5)

    plt.tight_layout()
    plt.savefig(output_dir / 'graph1_ai_usage_frequency.png', dpi=300, bbox_inches='tight',
                facecolor='white', edgecolor='none')
    print("✅ Created: graph1_ai_usage_frequency.png")
    plt.close()


def graph2_ecommerce_ai_usage(headers, responses, output_dir):
    """Graph 2: AI assistant usage in e-commerce (Pie chart - no explode, blue gradient by size)"""
    col_idx = 23

    values = []
    for response in responses:
        if col_idx < len(response):
            val = response[col_idx].strip()
            if val:
                values.append(val)

    counter = Counter(values)

    yes_count = counter.get('1', 0)
    no_count = counter.get('2', 0)

    labels = []
    sizes = []
    if yes_count > 0:
        labels.append('Yes')
        sizes.append(yes_count)
    if no_count > 0:
        labels.append('No')
        sizes.append(no_count)

    # Value-based blue gradient (pie should not be too light)
    colors_list = blue_gradient_by_value(sizes, low=0.55, high=0.95)

    fig, ax = plt.subplots(figsize=(10, 10))
    fig.patch.set_facecolor('white')

    wedges, texts, autotexts = ax.pie(
        sizes,
        labels=labels,
        colors=colors_list,
        autopct='%1.1f%%',
        startangle=90,
        shadow=False,
        textprops={'fontsize': 14, 'fontweight': '700', 'color': '#1e293b'},
        wedgeprops={'edgecolor': 'white', 'linewidth': 3}
    )

    for autotext in autotexts:
        autotext.set_color('white')
        autotext.set_fontsize(16)
        autotext.set_fontweight('700')

    for text in texts:
        text.set_fontsize(13)
        text.set_fontweight('600')
        text.set_color('#374151')

    ax.set_title('Have You Ever Used the AI Assistant\nFunction in E-commerce?',
                 fontsize=16, fontweight='700', color='#111827', pad=30)

    legend_elements = []
    for label, size, color in zip(labels, sizes, colors_list):
        legend_elements.append(
            mpatches.Patch(facecolor=color, edgecolor='white', linewidth=2,
                           label=f'{label}: {size} participants')
        )

    ax.legend(handles=legend_elements, loc='center', bbox_to_anchor=(0.5, -0.1),
              frameon=False, fontsize=12, ncol=2)

    plt.tight_layout()
    plt.savefig(output_dir / 'graph2_ecommerce_ai_usage.png', dpi=300, bbox_inches='tight',
                facecolor='white', edgecolor='none')
    print("✅ Created: graph2_ecommerce_ai_usage.png")
    plt.close()


def graph3_ai_helpfulness(headers, responses, output_dir):
    """Graph 3: 'I think AI assistant is very helpful in e-commerce' (Bar chart)
    Must show all 5 Likert scale options
    """
    col_idx = 30

    values = []
    for response in responses:
        if col_idx < len(response):
            val = response[col_idx].strip()
            if val:
                values.append(val)

    likert_labels = {
        '1': 'Totally\nDisagree',
        '2': 'Disagree',
        '3': 'Neutral',
        '4': 'Agree',
        '5': 'Totally\nAgree'
    }

    counter = Counter(values)

    labels = []
    counts = []
    for key in ['1', '2', '3', '4', '5']:
        labels.append(likert_labels[key])
        counts.append(counter.get(key, 0))

    # Value-based blue gradient
    colors_list = blue_gradient_by_value(counts, low=0.30, high=0.90)

    fig, ax = plt.subplots(figsize=(11, 7))
    fig.patch.set_facecolor('white')

    bars = ax.bar(labels, counts, color=colors_list,
                  edgecolor='white', linewidth=2.5,
                  alpha=0.9)

    for bar, count in zip(bars, counts):
        height = bar.get_height()
        ax.text(bar.get_x() + bar.get_width()/2., height + 0.1,
                f'{int(count)}',
                ha='center', va='bottom',
                fontsize=13, fontweight='700',
                color='#1e293b')

    ax.set_xlabel('Agreement Level', fontsize=13, fontweight='600', color='#374151', labelpad=12)
    ax.set_ylabel('Number of Participants', fontsize=13, fontweight='600', color='#374151', labelpad=12)
    ax.set_title('I Think That AI in E-commerce\nis Very Helpful',
                 fontsize=16, fontweight='700', color='#111827', pad=25)

    ax.set_ylim(0, max(counts) * 1.4 if counts else 1)
    max_y = int(max(counts) * 1.4) if counts else 1
    ax.set_yticks(np.arange(0, max_y + 1, 1))
    ax.grid(True, alpha=0.2, linestyle='--', linewidth=0.8, axis='y')
    ax.set_axisbelow(True)

    plt.xticks(rotation=0, ha='center', fontsize=11, color='#4b5563')
    ax.spines['bottom'].set_color('#e5e7eb')
    ax.spines['left'].set_color('#e5e7eb')
    ax.spines['bottom'].set_linewidth(1.5)
    ax.spines['left'].set_linewidth(1.5)

    plt.tight_layout()
    plt.savefig(output_dir / 'graph3_ai_helpfulness.png', dpi=300, bbox_inches='tight',
                facecolor='white', edgecolor='none')
    print("✅ Created: graph3_ai_helpfulness.png")
    plt.close()

def graph4_concerns(headers, responses, output_dir):
    """Graph 4: Concerns towards AI assistant in e-commerce (Vertical bar chart)
    Multiple choice - show as percentage
    Sorted by percentage (descending)
    """
    concern_labels = [
        'Privacy issues',
        'Inconvenient\n(Not easy to use, Confusing)',
        'Not helpful',
        'Irrelevant to\nmy requirement',
        'Over explanation',
        'Other'
    ]

    concern_cols = [24, 25, 26, 27, 28, 29]

    total_participants = len(responses)

    # (label, pct, count, original_index)
    items = []
    for idx, (label, col_idx) in enumerate(zip(concern_labels, concern_cols)):
        count = 0
        for response in responses:
            if col_idx < len(response) and response[col_idx].strip() == '1':
                count += 1
        pct = (count / total_participants * 100.0) if total_participants > 0 else 0.0
        items.append((label, pct, count, idx))

    # sort: percentage desc, tie -> original order
    items_sorted = sorted(items, key=lambda x: (-x[1], x[3]))

    sorted_labels = [x[0] for x in items_sorted]
    sorted_pcts   = [x[1] for x in items_sorted]
    sorted_counts = [x[2] for x in items_sorted]

    # Value-based blue gradient by percentage (after sorting)
    colors_list = blue_gradient_by_value(sorted_pcts, low=0.30, high=0.90)

    fig, ax = plt.subplots(figsize=(12, 7))
    fig.patch.set_facecolor('white')

    bars = ax.bar(
        sorted_labels,
        sorted_pcts,
        color=colors_list,
        edgecolor='white',
        linewidth=2.5,
        alpha=0.9
    )

    # annotate percentage on top
    for bar, pct in zip(bars, sorted_pcts):
        height = bar.get_height()
        ax.text(
            bar.get_x() + bar.get_width() / 2.0,
            height + 1.0,
            f'{pct:.1f}%',
            ha='center',
            va='bottom',
            fontsize=13,
            fontweight='700',
            color='#1e293b'
        )

    ax.set_xlabel('Concern Type', fontsize=13, fontweight='600', color='#374151', labelpad=12)
    ax.set_ylabel('Percentage of Participants (%)', fontsize=13, fontweight='600', color='#374151', labelpad=12)
    ax.set_title(
        'What Concerns Do You Have When Using\nAI Assistant in E-commerce?',
        fontsize=16, fontweight='700', color='#111827', pad=25
    )

    max_pct = max(sorted_pcts) if sorted_pcts else 0
    ax.set_ylim(0, max_pct + 15)
    ax.set_yticks(np.arange(0, max_pct + 20, 10))
    ax.grid(True, alpha=0.2, linestyle='--', linewidth=0.8, axis='y')
    ax.set_axisbelow(True)

    plt.xticks(rotation=25, ha='right', fontsize=10, color='#4b5563')
    ax.spines['bottom'].set_color('#e5e7eb')
    ax.spines['left'].set_color('#e5e7eb')
    ax.spines['bottom'].set_linewidth(1.5)
    ax.spines['left'].set_linewidth(1.5)

    plt.tight_layout()
    plt.savefig(output_dir / 'graph4_concerns.png', dpi=300, bbox_inches='tight',
                facecolor='white', edgecolor='none')
    print("✅ Created: graph4_concerns.png")
    plt.close()


def graph5_ai_usage_purpose(headers, responses, output_dir):
    """Graph 5: What do you use generative AI tools for? (Bar chart)
    Multiple choice - show as percentage
    """
    purpose_labels = [
        'Study',
        'Work',
        'General Inquires\nin daily life',
        'Shopping',
        'Medical\nConsultation',
        'All above',
        'Other'
    ]

    purpose_cols = [15, 16, 17, 18, 19, 20, 21]

    total_participants = len(responses)
    purpose_counts = []
    purpose_percentages = []

    for col_idx in purpose_cols:
        count = 0
        for response in responses:
            if col_idx < len(response):
                val = response[col_idx].strip()
                if val == '1':
                    count += 1
        purpose_counts.append(count)
        purpose_percentages.append((count / total_participants * 100) if total_participants > 0 else 0)

    # Value-based blue gradient by percentage
    purpose_colors = blue_gradient_by_value(purpose_percentages, low=0.30, high=0.90)

    fig, ax = plt.subplots(figsize=(12, 7))
    fig.patch.set_facecolor('white')

    bars = ax.bar(purpose_labels, purpose_percentages, color=purpose_colors,
                  edgecolor='white', linewidth=2.5,
                  alpha=0.9)

    for bar, pct in zip(bars, purpose_percentages):
        height = bar.get_height()
        ax.text(bar.get_x() + bar.get_width()/2., height + 2,
                f'{pct:.1f}%',
                ha='center', va='bottom',
                fontsize=13, fontweight='700',
                color='#1e293b')

    ax.set_xlabel('Purpose', fontsize=13, fontweight='600', color='#374151', labelpad=12)
    ax.set_ylabel('Percentage of Participants (%)', fontsize=13, fontweight='600', color='#374151', labelpad=12)
    ax.set_title('What Do You Use Generative AI Tools for?',
                 fontsize=16, fontweight='700', color='#111827', pad=25)

    max_pct = max(purpose_percentages) if purpose_percentages else 100
    ax.set_ylim(0, max_pct + 20)
    ax.set_yticks(np.arange(0, max_pct + 30, 10))
    ax.grid(True, alpha=0.2, linestyle='--', linewidth=0.8, axis='y')
    ax.set_axisbelow(True)

    plt.xticks(rotation=45, ha='right', fontsize=10, color='#4b5563')
    ax.spines['bottom'].set_color('#e5e7eb')
    ax.spines['left'].set_color('#e5e7eb')
    ax.spines['bottom'].set_linewidth(1.5)
    ax.spines['left'].set_linewidth(1.5)

    plt.tight_layout()
    plt.savefig(output_dir / 'graph5_ai_usage_purpose.png', dpi=300, bbox_inches='tight',
                facecolor='white', edgecolor='none')
    print("✅ Created: graph5_ai_usage_purpose.png")
    plt.close()


def main():
    setup_modern_style()

    analysis_dir = Path(__file__).parent

    print("=" * 80)
    print("CREATING CORRECTED MODERN QUESTIONNAIRE GRAPHS (BLUE GRADIENT BY VALUE)")
    print("=" * 80)

    pre_file = analysis_dir / 'pre-test_Tsinghua University AI E-commerce Assistant_7_6(Sheet1).csv'
    print(f"\nLoading data: {pre_file.name}")
    headers, responses = parse_csv_file(pre_file)
    print(f"  ✓ {len(responses)} participants")

    output_dir = analysis_dir / 'analysis_output' / 'graphs'
    output_dir.mkdir(parents=True, exist_ok=True)

    print("\nGenerating corrected graphs with blue gradients by values...")
    print("-" * 80)

    graph1_ai_usage_frequency(headers, responses, output_dir)
    graph2_ecommerce_ai_usage(headers, responses, output_dir)
    graph3_ai_helpfulness(headers, responses, output_dir)
    graph4_concerns(headers, responses, output_dir)
    graph5_ai_usage_purpose(headers, responses, output_dir)

    print("-" * 80)
    print("\n✅ All corrected graphs created successfully!")
    print(f"   Output directory: {output_dir}/")
    print("   Files created:")
    print("     - graph1_ai_usage_frequency.png")
    print("     - graph2_ecommerce_ai_usage.png")
    print("     - graph3_ai_helpfulness.png")
    print("     - graph4_concerns.png")
    print("     - graph5_ai_usage_purpose.png")


if __name__ == '__main__':
    main()
