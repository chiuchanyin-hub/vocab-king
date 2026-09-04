import pandas as pd
import json
import random

# 讀取你原本的 Excel 檔案
excel_path = "112-115學測高中英文參考詞彙全表_依頻率降序排列 (1).xlsx"
df_clean = pd.read_excel(excel_path, sheet_name='高中英文全單字表 (頻率降序)', skiprows=3)
df_clean.columns = ['Rank', 'Word', 'POS', 'Level', 'Chinese', 'Frequency', 'LevelDesc', 'Tag']

sample_questions = []
words_list = df_clean['Word'].tolist()

print("正在處理 5,983 個單字並依照每 20 個一章切分 (CH1 ~ CH300)...")
for idx, row in df_clean.iterrows():
    word = str(row['Word']).strip()
    zh = str(row['Chinese']).strip()
    ch_num = (idx // 20) + 1
    ch_name = f"CH{ch_num}"
    pos = str(row['POS']).strip()

    # 隨機挑選 3 個干擾項
    distractors = [w for w in words_list if w != word]
    options = [word] + random.sample(distractors, 3)
    random.shuffle(options)

    q_item = {
        "id": idx + 1,
        "chapter": ch_name,
        "word": word,
        "pos": pos,
        "isPhrase": " " in word or "-" in word,
        "zh": zh,
        "sentence": f"The student needs to learn the word ___ ({zh}).",
        "options": options
    }
    sample_questions.append(q_item)

# 儲存為 vocab_questions_master.json
with open('vocab_questions_master.json', 'w', encoding='utf-8') as f:
    json.dump(sample_questions, f, ensure_ascii=False, indent=2)

print(f"🎉 成功在專案中產生 vocab_questions_master.json！總共包含 {len(sample_questions)} 題。")