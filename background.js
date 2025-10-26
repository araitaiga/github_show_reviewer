// Listen for extension installation or update
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Open options page when extension is newly installed
    chrome.runtime.openOptionsPage();
  }
  // Optionally, you can also open on update:
  // else if (details.reason === 'update') {
  //   chrome.runtime.openOptionsPage();
  // }
});
