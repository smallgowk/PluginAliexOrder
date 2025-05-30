// Popup script with Start/Stop functionality
function initializeExtension() {
    console.log('Initializing extension...');
    
    const crawlButton = document.getElementById('crawlButton');
    const crawlStatus = document.getElementById('crawlStatus');
    const sheetNameInput = document.getElementById('sheetNameInput');

    // Load sheetName from localStorage nếu có
    if (sheetNameInput) {
        const savedSheetName = localStorage.getItem('sheetName');
        if (savedSheetName) {
            sheetNameInput.value = savedSheetName;
        }
        // Lưu lại mỗi khi người dùng thay đổi
        sheetNameInput.addEventListener('input', function() {
            localStorage.setItem('sheetName', sheetNameInput.value);
        });
    }

    // Check if required elements exist
    if (!crawlButton || !crawlStatus) {
        console.error('Missing required elements:', {
            crawlButton: !!crawlButton,
            crawlStatus: !!crawlStatus
        });
        return;
    }

    // Track current state
    let isTaskRunning = false;

    // Debug function
    function debug(message, data = null) {
        console.log(`[DEBUG] ${message}`, data);
    }

    // Update button state
    function updateButtonState(running) {
        isTaskRunning = running;
        if (running) {
            crawlButton.textContent = 'Stop';
            crawlButton.style.backgroundColor = '#f44336'; // Red color
        } else {
            crawlButton.textContent = 'Start';
            crawlButton.style.backgroundColor = '#4CAF50'; // Green color
        }
        crawlButton.disabled = false; // Always keep button enabled
    }

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'UPDATE_STATUS') {
            crawlStatus.textContent = message.data.status || `Crawling page ${message.data.currentPage}... Found ${message.data.totalItems} items so far`;
            updateButtonState(!!message.data.isTaskRunning);
        } else if (message.type === 'CRAWL_COMPLETE') {
            crawlStatus.textContent = `Crawling completed. Found ${message.data.totalItems} items in total`;
            updateButtonState(false);
        } else if (message.type === 'EXPORT_COMPLETE') {
            crawlStatus.textContent = `Found ${message.data.totalItems} unique items. File saved to Downloads folder as ${message.data.fileName}`;
            updateButtonState(false);
        } else if (message.type === 'CRAWL_ERROR' || message.type === 'EXPORT_ERROR') {
            crawlStatus.textContent = `Error: ${message.error}`;
            updateButtonState(false);
        }
    });

    // Handle button click (Start/Stop toggle)
    crawlButton.addEventListener('click', async function() {
        if (isTaskRunning) {
            // Stop the task
            crawlStatus.textContent = 'Stopping...';
            try {
                const response = await chrome.runtime.sendMessage({
                    type: 'STOP_FETCH_TRACKING'
                });
                
                if (response && response.success) {
                    crawlStatus.textContent = 'Stopped by user';
                    updateButtonState(false);
                } else {
                    crawlStatus.textContent = 'Failed to stop task';
                }
            } catch (error) {
                crawlStatus.textContent = 'Error stopping task: ' + error.message;
                updateButtonState(false);
            }
        } else {
            // Start the task
            crawlStatus.textContent = 'Checking current tab...';
            
            try {
                // Get current tab
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab || !tab.url) throw new Error('Cannot find current tab URL');

                // Check Google Sheets format
                const sheetUrlPattern = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)\/edit/;
                const match = tab.url.match(sheetUrlPattern);
                if (!match) throw new Error('Current tab is not a Google Sheets!');
                
                const sheetId = match[1];
                const sheetNameInput = document.getElementById('sheetNameInput');
                const sheetName = sheetNameInput && sheetNameInput.value ? sheetNameInput.value : 'Tiktok Shop';

                // Send message to background to start fetching
                const response = await chrome.runtime.sendMessage({
                    type: 'START_FETCH_TRACKING',
                    sheetId,
                    sheetName,
                    tabId: tab.id
                });

                if (response && response.success === false) {
                    crawlStatus.textContent = response.message || 'Failed to start tracking';
                    updateButtonState(false);
                } else {
                    // Task started successfully
                    updateButtonState(true);
                }
                
            } catch (error) {
                crawlStatus.textContent = 'Error: ' + error.message;
                updateButtonState(false);
            }
        }
    });

    console.log('Extension initialized successfully');
}

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // Get current status from background
    chrome.runtime.sendMessage({ type: 'GET_CURRENT_STATUS' }, function(status) {
        const crawlStatus = document.getElementById('crawlStatus');
        const crawlButton = document.getElementById('crawlButton');
        
        if (status && status.status && crawlStatus) {
            crawlStatus.textContent = status.status;
        }
        
        // Set initial button state based on task status
        if (crawlButton) {
            const isRunning = !!(status && status.isTaskRunning);
            if (isRunning) {
                crawlButton.textContent = 'Stop';
                crawlButton.style.backgroundColor = '#f44336';
            } else {
                crawlButton.textContent = 'Start';
                crawlButton.style.backgroundColor = '#4CAF50';
            }
            crawlButton.disabled = false;
        }
    });
    
    initializeExtension();
});