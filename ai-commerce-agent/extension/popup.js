function clickAnalyze(){
  chrome.tabs.query({active:true, currentWindow:true}, tabs => {
    const tabId = tabs[0].id;
    chrome.scripting.executeScript({ target: { tabId }, func: () => document.getElementById('aic-analyze')?.click() });
  });
}
function runSearch(){
  const kw = document.getElementById('kw').value.trim();
  const provider = document.getElementById('provider').value;
  chrome.tabs.query({active:true, currentWindow:true}, tabs => {
    const tabId = tabs[0].id;
    chrome.scripting.executeScript({
      target: { tabId },
      args: [kw, provider],
      func: (kw, provider) => {
        const kwBox = document.querySelector('#aic-kw');
        if (kwBox) kwBox.value = kw;
        const sel = document.querySelector('#aic-provider');
        if (sel) sel.value = provider;
        document.getElementById('aic-search')?.click();
      }
    });
  });
}
document.getElementById('trigger').addEventListener('click', clickAnalyze);
document.getElementById('doSearch').addEventListener('click', runSearch);
