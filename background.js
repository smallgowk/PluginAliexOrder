// Background script to handle continuous crawling
let isCrawling = false;
let currentTabId = null;
let crawledItemIds = new Set();
let currentTrackingStatus = null;

// Function to reset crawling state
function resetCrawlingState() {
    isCrawling = false;
    currentTabId = null;
    crawledItemIds.clear();
    pageCount = 0;
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_CRAWL') {
        if (!isCrawling) {
            isCrawling = true;
            currentTabId = message.tabId;
            crawledItemIds.clear();
            startCrawling(message.tabId);
            sendResponse({ success: true });
        } else {
            // If crawling is stuck, allow force reset
            if (message.forceReset) {
                resetCrawlingState();
                isCrawling = true;
                currentTabId = message.tabId;
                startCrawling(message.tabId);
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false, message: 'Crawling already in progress' });
            }
        }
    } else if (message.type === 'STOP_CRAWL') {
        resetCrawlingState();
        sendResponse({ success: true });
    } else if (message.type === 'RESET_CRAWL_STATE') {
        resetCrawlingState();
        sendResponse({ success: true });
    } else if (message.type === 'START_FETCH_TRACKING') {
        handleFetchTracking(message, sender, sendResponse);
        return true;
    } else if (message.type === 'GET_CURRENT_STATUS') {
        sendResponse(currentTrackingStatus);
        return true;
    }
    return true;
});

// Function to find and click next button
async function findAndClickNext(tabId) {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: () => {
                const nextButtons = Array.from(document.querySelectorAll('div[style*="background-image"]'));
                if (nextButtons.length > 0) {
                    const nextButton = nextButtons[nextButtons.length - 1];
                    if (nextButton && nextButton.offsetParent !== null) {
                        nextButton.click();
                        return true;
                    }
                }
                return false;
            }
        });
        return results && results[0] && results[0].result;
    } catch (error) {
        console.error('Error finding/clicking next button:', error);
        return false;
    }
}

// Function to crawl a single page
async function crawlPage(tabId) {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: () => {
                try {
                    const links = Array.from(document.querySelectorAll('a[href*="/item/"]'));
                    const itemIds = links.map(link => {
                        const match = link.href.match(/\/item\/(\d+)/);
                        return match ? match[1] : null;
                    }).filter(id => id !== null);
                    return [...new Set(itemIds)];
                } catch (error) {
                    console.error('Error in content script:', error);
                    throw error;
                }
            }
        });

        if (results && results[0] && results[0].result) {
            const newIds = results[0].result;
            newIds.forEach(id => crawledItemIds.add(id));
            
            // Update popup status if it's open
            chrome.runtime.sendMessage({
                type: 'UPDATE_STATUS',
                data: {
                    currentPage: pageCount,
                    totalItems: crawledItemIds.size
                }
            });
            
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error crawling page:', error);
        return false;
    }
}

// Function to export IDs to file
async function exportIdsToFile(ids) {
    try {
        const fileName = `item_ids_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
        const content = Array.from(ids).join('\n');
        
        // Create a Blob using the Blob constructor
        const blob = new Blob([content], { type: 'text/plain' });
        
        // Create a download URL using chrome.runtime.getURL
        const url = await chrome.runtime.getURL('download.html');
        
        // Send the data to the download page
        await chrome.runtime.sendMessage({
            type: 'DOWNLOAD_DATA',
            data: {
                content: content,
                fileName: fileName
            }
        });
        
        return fileName;
    } catch (error) {
        console.error('Error exporting file:', error);
        throw error;
    }
}

let pageCount = 0;
const maxPages = 10;

// Main crawling function
async function startCrawling(tabId) {
    try {
        pageCount = 0;
        
        while (pageCount < maxPages && isCrawling) {
            pageCount++;
            
            // Crawl current page
            const success = await crawlPage(tabId);
            if (!success) {
                chrome.runtime.sendMessage({
                    type: 'CRAWL_ERROR',
                    error: 'Failed to crawl page'
                });
                break;
            }

            // Try to find and click next button
            const hasNext = await findAndClickNext(tabId);
            if (!hasNext) {
                chrome.runtime.sendMessage({
                    type: 'CRAWL_COMPLETE',
                    data: {
                        totalItems: crawledItemIds.size
                    }
                });
                break;
            }

            // Wait for page to load
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        if (crawledItemIds.size > 0) {
            try {
                const fileName = await exportIdsToFile(crawledItemIds);
                chrome.runtime.sendMessage({
                    type: 'EXPORT_COMPLETE',
                    data: {
                        fileName: fileName,
                        totalItems: crawledItemIds.size
                    }
                });
            } catch (error) {
                chrome.runtime.sendMessage({
                    type: 'EXPORT_ERROR',
                    error: 'Failed to export file'
                });
            }
        }
    } catch (error) {
        console.error('Error in startCrawling:', error);
        chrome.runtime.sendMessage({
            type: 'CRAWL_ERROR',
            error: error.message
        });
    } finally {
        // Always reset crawling state when done
        resetCrawlingState();
    }
}

async function handleFetchTracking(message, sender, sendResponse) {
    const BASE_API_URL = 'http://iamhere.vn:89/api/ggsheet';
    const { sheetId, sheetName, tabId } = message;
    try {
        currentTrackingStatus = { currentPage: 0, totalItems: 0, status: 'Fetching orderId list from Google Sheet...' };
        chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', data: currentTrackingStatus });
        const infoRes = await fetch(`${BASE_API_URL}/getInfo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: sheetId, sheetName })
        });
        if (!infoRes.ok) throw new Error('Error calling getInfo API');
        const infoData = await infoRes.json();
        if (!infoData.data || !Array.isArray(infoData.data)) throw new Error('Invalid API response');
        const orderIds = infoData.data;
        if (orderIds.length === 0) throw new Error('No orderId found in sheet!');
        currentTrackingStatus = { currentPage: 0, totalItems: orderIds.length, status: `Crawling tracking number for ${orderIds.length} orderId...` };
        chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', data: currentTrackingStatus });
        for (let i = 0; i < orderIds.length; i++) {
            const orderId = orderIds[i];
            currentTrackingStatus = { currentPage: i+1, totalItems: orderIds.length, status: `(${i+1}/${orderIds.length}) Getting tracking for orderId: ${orderId}` };
            chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', data: currentTrackingStatus });
            // Open tracking tab
            const trackingUrl = `https://www.aliexpress.com/p/tracking/index.html?_addShare=no&_login=yes&tradeOrderId=${orderId}`;
            const trackingTab = await chrome.tabs.create({ url: trackingUrl, active: false });
            await new Promise(resolve => setTimeout(resolve, 4000));
            // Inject script to get tracking number
            const [{ result: trackingNumberRaw }] = await chrome.scripting.executeScript({
                target: { tabId: trackingTab.id },
                func: () => {
                    const el = document.querySelector('.logistic-info-v2--mailNoValue--X0fPzen');
                    return el ? el.textContent.trim() : '';
                }
            });
            const trackingNumber = trackingNumberRaw || 'Error!';
            await chrome.tabs.remove(trackingTab.id);
            // Update sheet
            currentTrackingStatus = { currentPage: i+1, totalItems: orderIds.length, status: `Updating tracking for orderId: ${orderId}...` };
            chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', data: currentTrackingStatus });
            const datamap = {};
            datamap[orderId] = trackingNumber;
            const updateRes = await fetch(`${BASE_API_URL}/update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: sheetId, sheetName, datamap })
            });
            if (!updateRes.ok) {
                currentTrackingStatus = { currentPage: i+1, totalItems: orderIds.length, status: `Error updating orderId: ${orderId}` };
                chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', data: currentTrackingStatus });
            } else {
                currentTrackingStatus = { currentPage: i+1, totalItems: orderIds.length, status: `Updated tracking for orderId: ${orderId}` };
                chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', data: currentTrackingStatus });
            }
        }
        currentTrackingStatus = { currentPage: orderIds.length, totalItems: orderIds.length, status: 'All tracking numbers updated!' };
        chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', data: currentTrackingStatus });
    } catch (error) {
        currentTrackingStatus = { currentPage: 0, totalItems: 0, status: 'Error: ' + error.message };
        chrome.runtime.sendMessage({ type: 'CRAWL_ERROR', error: error.message });
    }
} 