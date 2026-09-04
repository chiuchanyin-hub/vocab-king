// --- 核心輔助：取得目前使用者在後台選定或填寫的章節名稱 ---
function getTargetImportChapter() {
  const customInput = document.getElementById('import-chapter-custom').value.trim();
  if (customInput) return customInput;
  const selectVal = document.getElementById('import-chapter-select').value;
  return selectVal || "Unit 1";
}

// 刷新後台「指定匯入章節」的下拉選單清單
function refreshAdminChapterSelector() {
  const select = document.getElementById('import-chapter-select');
  if (!select) return;
  // 排除「全部章節」，僅抓取既有的獨立章節
  const uniqueChapters = [...new Set(allQuestions.map(q => q.chapter || "Unit 1"))];
  select.innerHTML = uniqueChapters.map(c => `<option value="${c}">現有章節：${c}</option>`).join('');
}

// 在原有的 updateChapterDropdowns 結尾呼叫 refreshAdminChapterSelector()
const originalUpdateChapterDropdowns = updateChapterDropdowns;
updateChapterDropdowns = function() {
  originalUpdateChapterDropdowns();
  refreshAdminChapterSelector();
};

// =================== 📸 1. 圖片上傳辨識並指定章節 ===================
document.getElementById('ocr-image-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const targetChapter = getTargetImportChapter();
  const statusBar = document.getElementById('ocr-status-bar');
  const statusText = document.getElementById('ocr-status-text');
  const progressInner = document.getElementById('ocr-progress-inner');
  const resultContainer = document.getElementById('ocr-result-container');
  const jsonOutput = document.getElementById('ocr-json-output');

  statusBar.style.display = 'block';
  resultContainer.style.display = 'none';

  try {
    const result = await Tesseract.recognize(file, 'chi_tra+eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          const pct = Math.floor(m.progress * 100);
          statusText.innerText = `正在分析圖片單字中... ${pct}%`;
          progressInner.style.width = `${pct}%`;
        }
      }
    });

    statusText.innerText = "文字辨識完成，正在智慧建立題目結構...";
    const parsedData = parseOcrTextToQuiz(result.data.text, targetChapter);

    jsonOutput.value = JSON.stringify(parsedData, null, 2);
    document.getElementById('pending-chapter-badge').innerText = `目標章節: ${targetChapter}`;
    resultContainer.style.display = 'block';
    statusBar.style.display = 'none';

    alert(`🎉 辨識完成！已自動將題目設定為【${targetChapter}】，請校對後點擊「確認套用設定並匯入」。`);
  } catch (err) {
    console.error("圖片辨識失敗：", err);
    alert("圖片解析失敗，請確認圖片清晰度。");
    statusBar.style.display = 'none';
  }
});

// =================== 📂 2. 現有 JSON 檔案直接匯入並覆寫章節 ===================
document.getElementById('json-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const targetChapter = getTargetImportChapter();
  const reader = new FileReader();

  reader.onload = (event) => {
    try {
      let data = JSON.parse(event.target.result);
      if (!Array.isArray(data)) {
        alert("JSON 格式必須為陣列（Array）！");
        return;
      }

      // 將讀入的題目全部統一改為設定的章節名稱
      data = data.map(item => ({
        ...item,
        id: item.id || (Date.now() + Math.floor(Math.random() * 10000)),
        chapter: targetChapter
      }));

      document.getElementById('ocr-json-output').value = JSON.stringify(data, null, 2);
      document.getElementById('pending-chapter-badge').innerText = `目標章節: ${targetChapter}`;
      document.getElementById('ocr-result-container').style.display = 'block';

      alert(`📂 已載入 ${data.length} 題，章節已統一配置為【${targetChapter}】，確認後請點擊匯入！`);
    } catch (err) {
      alert("讀取 .json 檔案失敗，請確認檔案格式是否正確。");
    }
  };

  reader.readAsText(file);
});

// =================== ✅ 3. 確認套用設定並匯入題庫 ===================
document.getElementById('confirm-import-btn').addEventListener('click', () => {
  try {
    const jsonStr = document.getElementById('ocr-json-output').value;
    let newItems = JSON.parse(jsonStr);

    if (!Array.isArray(newItems) || newItems.length === 0) {
      alert("題目內容為空！");
      return;
    }

    // 取得當前設定的目標章節，進行最後確認綁定
    const finalChapter = getTargetImportChapter();
    newItems = newItems.map(q => ({
      ...q,
      chapter: q.chapter || finalChapter
    }));

    // 寫入自訂題庫並儲存 LocalStorage
    customQuestions = [...customQuestions, ...newItems];
    localStorage.setItem('custom_questions', JSON.stringify(customQuestions));
    
    // 重新整理系統全域題庫與選單
    refreshTotalQuestions();
    renderAdminList();

    alert(`✅ 成功匯入 ${newItems.length} 個單字至【${finalChapter}】章節！`);
    
    // 清空輸入並收合預覽區塊
    document.getElementById('ocr-result-container').style.display = 'none';
    document.getElementById('import-chapter-custom').value = '';
    document.getElementById('ocr-image-input').value = '';
    document.getElementById('json-file-input').value = '';
  } catch (err) {
    alert("JSON 語法錯誤，請確認括號與逗號格式完整。");
  }
});

// 下載目前產生的 .json 備份檔
document.getElementById('download-parsed-json-btn').addEventListener('click', () => {
  const jsonStr = document.getElementById('ocr-json-output').value;
  const targetChapter = getTargetImportChapter();
  const dl = document.createElement('a');
  dl.setAttribute("href", "data:text/json;charset=utf-8," + encodeURIComponent(jsonStr));
  dl.setAttribute("download", `${targetChapter}_題庫_${Date.now()}.json`);
  document.body.appendChild(dl);
  dl.click();
  dl.remove();
});