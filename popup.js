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
            crawlStatus.textContent = `Crawling page ${message.data.currentPage}... Found ${message.data.totalItems} items so far`;
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

    // Handle URL crawling
    crawlButton.addEventListener('click', async function() {
        console.log('[Start] Button clicked');
        crawlStatus.textContent = 'Checking current tab...';
        crawlButton.disabled = true;
        try {
            // Get current tab
            console.log('[Step] Getting current tab...');
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            console.log('[Step] Tab info:', tab);
            if (!tab || !tab.url) throw new Error('Cannot find current tab URL');

            // Check Google Sheets format
            console.log('[Step] Checking if tab is Google Sheets...');
            const sheetUrlPattern = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)\/edit/;
            const match = tab.url.match(sheetUrlPattern);
            if (!match) throw new Error('Current tab is not a Google Sheets!');
            const sheetId = match[1];
            const sheetName = 'Tiktok Shop'; // Can be made dynamic if needed
            console.log('[Step] Google Sheet ID:', sheetId);

            crawlStatus.textContent = 'Fetching orderId list from Google Sheet...';
            console.log('[Step] Calling getInfo API...');
            // Call API to get orderId
            const infoRes = await fetch('http://localhost:89/api/ggsheet/getInfo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: sheetId, sheetName })
            });
            console.log('[Step] getInfo API response status:', infoRes.status);
            if (!infoRes.ok) throw new Error('Error calling getInfo API');
            const infoData = await infoRes.json();
            console.log('[Step] getInfo API response data:', infoData);
            if (!infoData.data || !Array.isArray(infoData.data)) throw new Error('Invalid API response');
            const orderIds = infoData.data;
            if (orderIds.length === 0) throw new Error('No orderId found in sheet!');

            crawlStatus.textContent = `Crawling tracking number for ${orderIds.length} orderId...`;
            console.log('[Step] Start crawling tracking numbers...');
            for (let i = 0; i < orderIds.length; i++) {
                const orderId = orderIds[i];
                crawlStatus.textContent = `(${i+1}/${orderIds.length}) Getting tracking for orderId: ${orderId}`;
                console.log(`[Step] Opening tracking tab for orderId: ${orderId}`);
                // Open tracking tab
                const trackingUrl = `https://www.aliexpress.com/p/tracking/index.html?_addShare=no&_login=yes&tradeOrderId=${orderId}`;
                const trackingTab = await chrome.tabs.create({ url: trackingUrl, active: false });
                // Wait for tab to load
                console.log('[Step] Waiting for tracking tab to load...');
                await new Promise(resolve => setTimeout(resolve, 4000));
                // Inject script to get tracking number
                console.log('[Step] Injecting script to get tracking number...');
                const [{ result: trackingNumber }] = await chrome.scripting.executeScript({
                    target: { tabId: trackingTab.id },
                    func: () => {
                        const el = document.querySelector('.logistic-info-v2--mailNoValue--X0fPzen');
                        return el ? el.textContent.trim() : '';
                    }
                });
                console.log(`[Step] Got tracking number for orderId ${orderId}:`, trackingNumber);
                // Close tab
                console.log('[Step] Closing tracking tab...');
                await chrome.tabs.remove(trackingTab.id);

                // Gửi request update cho orderId này
                crawlStatus.textContent = `Updating tracking for orderId: ${orderId}...`;
                console.log(`[Step] Calling update API for orderId: ${orderId}`);
                const datamap = {};
                datamap[orderId] = trackingNumber || '';
                const updateRes = await fetch('http://localhost:89/api/ggsheet/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: sheetId, sheetName, datamap })
                });
                console.log('[Step] update API response status:', updateRes.status);
                if (!updateRes.ok) {
                    crawlStatus.textContent = `Error updating orderId: ${orderId}`;
                    console.error(`[Error] Error updating orderId: ${orderId}`);
                } else {
                    crawlStatus.textContent = `Updated tracking for orderId: ${orderId}`;
                    console.log(`[Step] Updated tracking for orderId: ${orderId}`);
                }
            }

            crawlStatus.textContent = 'All tracking numbers updated!';
            console.log('[Step] All tracking numbers updated!');
        } catch (error) {
            crawlStatus.textContent = 'Error: ' + error.message;
            console.error('[Error]', error);
        } finally {
            crawlButton.disabled = false;
            console.log('[Step] Done. Button enabled.');
        }
    });

    console.log('Extension initialized successfully');
}

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing extension...');
    initializeExtension();
}); 