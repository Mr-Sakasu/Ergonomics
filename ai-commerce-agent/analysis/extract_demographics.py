#!/usr/bin/env python3
"""
Extract and analyze participant demographics from the data.
"""

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
    responses = []

    for line in lines[1:]:  # Skip header
        if line.strip():
            row = line.split(';')
            if row and any(cell.strip() for cell in row):
                responses.append(row)

    return responses

def analyze_demographics(responses):
    """Analyze demographics from responses."""
    # Column indices (0-based from split)
    # Column 6 = Gender (index 6)
    # Column 7 = Cultural Background (index 7)
    # Column 8 = Age (index 8)
    # Column 12 = Educational Background (index 12)

    gender_count = {'male': 0, 'female': 0}
    age_count = {}
    cultural_count = {}
    education_count = {}

    print("Participant Demographics (6 participants):")
    print("=" * 60)

    for idx, response in enumerate(responses, 1):
        if len(response) > 12:
            gender = response[6].strip() if len(response) > 6 else ''
            cultural = response[7].strip() if len(response) > 7 else ''
            age = response[8].strip() if len(response) > 8 else ''
            education = response[12].strip() if len(response) > 12 else ''

            print(f"\nParticipant {idx}:")
            print(f"  Gender: {gender} (1=male, 2=female)")
            print(f"  Cultural Background: {cultural} (1=Chinese?, 2=Other?)")
            print(f"  Age: {age}")
            print(f"  Education: {education}")

            # Count gender
            if gender == '1':
                gender_count['male'] += 1
            elif gender == '2':
                gender_count['female'] += 1

            # Count age
            age_count[age] = age_count.get(age, 0) + 1

            # Count cultural background
            cultural_count[cultural] = cultural_count.get(cultural, 0) + 1

            # Count education
            education_count[education] = education_count.get(education, 0) + 1

    print("\n" + "=" * 60)
    print("SUMMARY:")
    print("=" * 60)
    print(f"\nGender:")
    print(f"  Male: {gender_count['male']} ({gender_count['male']/6*100:.2f}%)")
    print(f"  Female: {gender_count['female']} ({gender_count['female']/6*100:.2f}%)")

    print(f"\nAge Distribution:")
    for age, count in sorted(age_count.items()):
        print(f"  Age category {age}: {count} participants")

    print(f"\nCultural Background:")
    for bg, count in sorted(cultural_count.items()):
        print(f"  Category {bg}: {count} participants")

    print(f"\nEducational Background:")
    for edu, count in sorted(education_count.items()):
        print(f"  Category {edu}: {count} participants")

    return {
        'gender': gender_count,
        'age': age_count,
        'cultural': cultural_count,
        'education': education_count
    }

def main():
    from pathlib import Path
    analysis_dir = Path(__file__).parent

    pre_file = analysis_dir / 'pre-test_Tsinghua University AI E-commerce Assistant_7_6(Sheet1).csv'
    print(f"Analyzing: {pre_file.name}\n")

    responses = parse_csv_file(pre_file)
    demographics = analyze_demographics(responses)

    print("\n" + "=" * 60)
    print("CORRECTED DEMOGRAPHICS FOR 6 PARTICIPANTS:")
    print("=" * 60)
    print(f"\nGender:")
    print(f"  {demographics['gender']['male']} male ({demographics['gender']['male']/6*100:.2f}%), {demographics['gender']['female']} female ({demographics['gender']['female']/6*100:.2f}%)")

    # Age interpretation (need to know what values mean)
    age_values = sorted([int(k) for k in demographics['age'].keys()])
    print(f"\nAge (values: {age_values}):")
    for age_val in age_values:
        count = demographics['age'][str(age_val)]
        print(f"  {count} participants in category {age_val}")

if __name__ == '__main__':
    main()
