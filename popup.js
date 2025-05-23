// Function to initialize the extension
function initializeExtension() {
    console.log('Initializing extension...');
    
    const crawlButton = document.getElementById('crawlButton');
    const crawlStatus = document.getElementById('crawlStatus');

    // Check if required elements exist
    if (!crawlButton || !crawlStatus) {
        console.error('Missing required elements:', {
            crawlButton: !!crawlButton,
            crawlStatus: !!crawlStatus
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

    console.log('Extension initialized successfully');
}

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    chrome.runtime.sendMessage({ type: 'GET_CURRENT_STATUS' }, function(status) {
        if (status && status.status) {
            const crawlStatus = document.getElementById('crawlStatus');
            if (crawlStatus) crawlStatus.textContent = status.status;
        }
        crawlButton.disabled = !!(status && status.isTaskRunning);
    });
    initializeExtension();
}); 