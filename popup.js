// Function to initialize the extension
function initializeExtension() {
    console.log('Initializing extension...');
    
    const crawlButton = document.getElementById('crawlButton');
    const crawlStatus = document.getElementById('crawlStatus');
    const autoRerunToggle = document.getElementById('autoRerunToggle');
    const intervalInput = document.getElementById('intervalInput');

    // Check if required elements exist
    if (!crawlButton || !crawlStatus || !autoRerunToggle || !intervalInput) {
        console.error('Missing required elements:', {
            crawlButton: !!crawlButton,
            crawlStatus: !!crawlStatus,
            autoRerunToggle: !!autoRerunToggle,
            intervalInput: !!intervalInput
        });
        return;
    }

    // Debug function
    function debug(message, data = null) {
        console.log(`[DEBUG] ${message}`, data);
        chrome.runtime.sendMessage({
            type: 'DEBUG',
            data: { message, data }
        });
    }

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'UPDATE_STATUS') {
            crawlStatus.textContent = message.data.status || `Crawling page ${message.data.currentPage}... Found ${message.data.totalItems} items so far`;
            crawlButton.disabled = !!message.data.isTaskRunning;
        } else if (message.type === 'CRAWL_COMPLETE') {
            crawlStatus.textContent = `Crawling completed. Found ${message.data.totalItems} items in total`;
            crawlButton.disabled = false;
        } else if (message.type === 'EXPORT_COMPLETE') {
            crawlStatus.textContent = `Found ${message.data.totalItems} unique items. File saved to Downloads folder as ${message.data.fileName}`;
        } else if (message.type === 'CRAWL_ERROR' || message.type === 'EXPORT_ERROR') {
            crawlStatus.textContent = `Error: ${message.error}`;
            crawlButton.disabled = false;
        }
    });

    const BASE_API_URL = 'http://iamhere.vn:89/api/ggsheet';

    // Handle URL crawling
    crawlButton.addEventListener('click', async function() {
        crawlStatus.textContent = 'Checking current tab...';
        crawlButton.disabled = true;
        try {
            // Get current tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.url) throw new Error('Cannot find current tab URL');

            // Check Google Sheets format
            const sheetUrlPattern = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)\/edit/;
            const match = tab.url.match(sheetUrlPattern);
            if (!match) throw new Error('Current tab is not a Google Sheets!');
            const sheetId = match[1];
            const sheetName = 'Tiktok Shop'; // Can be made dynamic if needed

            // Send message to background to start fetching
            chrome.runtime.sendMessage({
                type: 'START_FETCH_TRACKING',
                sheetId,
                sheetName,
                tabId: tab.id
            });
        } catch (error) {
            crawlStatus.textContent = 'Error: ' + error.message;
            crawlButton.disabled = false;
        }
    });

    // Khôi phục trạng thái Auto-Rerun và interval khi mở popup
    chrome.storage.local.get(['autoRerunEnabled', 'autoRerunInterval'], function(result) {
        if (autoRerunToggle) {
            autoRerunToggle.checked = !!result.autoRerunEnabled;
        }
        
        if (intervalInput) {
            intervalInput.value = result.autoRerunInterval || 10;
        }
        
        // Gửi trạng thái hiện tại đến background script
        chrome.runtime.sendMessage({
            type: 'SET_AUTO_RERUN',
            enabled: !!result.autoRerunEnabled,
            intervalSeconds: parseInt(intervalInput.value) || 10
        });
    });

    // Xử lý thay đổi interval
    if (intervalInput) {
        intervalInput.addEventListener('input', function() {
            let interval = parseInt(intervalInput.value);
            
            // Validate interval (5-3600 seconds)
            if (isNaN(interval) || interval < 5) {
                interval = 5;
                intervalInput.value = 5;
            } else if (interval > 3600) {
                interval = 3600;
                intervalInput.value = 3600;
            }
            
            // Lưu interval vào storage
            chrome.storage.local.set({ autoRerunInterval: interval });
            
            // Gửi interval mới đến background script
            chrome.runtime.sendMessage({
                type: 'SET_AUTO_RERUN_INTERVAL',
                intervalSeconds: interval
            }, function(response) {
                if (response && response.success) {
                    console.log('Auto-rerun interval updated to:', interval, 'seconds');
                }
            });
        });
        
        // Xử lý khi người dùng blur khỏi input (đảm bảo giá trị hợp lệ)
        intervalInput.addEventListener('blur', function() {
            let interval = parseInt(intervalInput.value);
            if (isNaN(interval) || interval < 5) {
                intervalInput.value = 5;
                intervalInput.dispatchEvent(new Event('input'));
            } else if (interval > 3600) {
                intervalInput.value = 3600;
                intervalInput.dispatchEvent(new Event('input'));
            }
        });
    }

    // Lưu trạng thái khi thay đổi toggle
    if (autoRerunToggle) {
        autoRerunToggle.addEventListener('change', function() {
            const isEnabled = autoRerunToggle.checked;
            const interval = parseInt(intervalInput.value) || 10;
            
            // Lưu trạng thái vào storage
            chrome.storage.local.set({ autoRerunEnabled: isEnabled });
            
            // Gửi message đến background script để bật/tắt auto-rerun
            chrome.runtime.sendMessage({
                type: 'SET_AUTO_RERUN',
                enabled: isEnabled,
                intervalSeconds: interval
            }, function(response) {
                if (response && response.success) {
                    console.log('Auto-rerun', isEnabled ? 'enabled' : 'disabled', 'with interval:', interval, 'seconds');
                    
                    // Cập nhật status message
                    if (isEnabled) {
                        crawlStatus.textContent = `Auto-rerun enabled. Will restart every ${interval} seconds when idle.`;
                    } else {
                        crawlStatus.textContent = 'Auto-rerun disabled.';
                    }
                } else {
                    console.error('Failed to set auto-rerun state');
                }
            });
        });
    }

    console.log('Extension initialized successfully');
}

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    chrome.runtime.sendMessage({ type: 'GET_CURRENT_STATUS' }, function(status) {
        if (status && status.status) {
            const crawlStatus = document.getElementById('crawlStatus');
            if (crawlStatus) crawlStatus.textContent = status.status;
        }
        const crawlButton = document.getElementById('crawlButton');
        if (crawlButton) crawlButton.disabled = !!(status && status.isTaskRunning);
    });
    initializeExtension();
});