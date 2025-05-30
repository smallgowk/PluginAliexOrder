// Background script - Removed Auto-rerun functionality
let isCrawling = false;
let currentTabId = null;
let crawledItemIds = new Set();
let currentTrackingStatus = null;
let isTaskRunning = false;
let lastTrackingMessage = null;

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
        if (isTaskRunning) {
            chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', data: { ...currentTrackingStatus, isTaskRunning: true } });
            sendResponse({ success: false, message: 'Task already running' });
            return true;
        }
        isTaskRunning = true;
        currentTrackingStatus = { ...currentTrackingStatus, isTaskRunning: true };
        lastTrackingMessage = message;
        chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', data: { ...currentTrackingStatus, status: 'Started tracking...', isTaskRunning: true } });
        handleFetchTracking(message, sender, sendResponse);
        sendResponse({ success: true });
        return true;
    } else if (message.type === 'STOP_FETCH_TRACKING') {
        isTaskRunning = false;
        currentTrackingStatus = { ...currentTrackingStatus, isTaskRunning: false };
        chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', data: { ...currentTrackingStatus, status: 'Stopped by user.', isTaskRunning: false } });
        sendResponse({ success: true });
        return true;
    } else if (message.type === 'GET_CURRENT_STATUS') {
        sendResponse({ ...currentTrackingStatus, isTaskRunning });
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
    const BASE_API_URL = 'http://localhost:89/api/ggsheet';
    const { sheetId, sheetName, tabId } = message;
    try {
        currentTrackingStatus = { currentPage: 0, totalItems: 0, status: 'Fetching orderId list from Google Sheet...', isTaskRunning: true };
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
        
        currentTrackingStatus = { currentPage: 0, totalItems: orderIds.length, status: `Crawling tracking number for ${orderIds.length} orderId...`, isTaskRunning: true };
        chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', data: currentTrackingStatus });
        
        for (let i = 0; i < orderIds.length; i++) {
            // Check if task was stopped
            if (!isTaskRunning) {
                chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', data: { status: 'Task stopped by user', isTaskRunning: false } });
                return;
            }
            
            const orderId = orderIds[i];
            currentTrackingStatus = { currentPage: i+1, totalItems: orderIds.length, status: `(${i+1}/${orderIds.length}) Getting tracking for orderId: ${orderId}`, isTaskRunning: true };
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
            
            // --- Lấy tracking status từ Cainiao ---
            let trackingStatus = '';
            if (trackingNumber && trackingNumber !== 'Error!') {
                const cainiaoUrl = `https://global.cainiao.com/newDetail.htm?mailNoList=${trackingNumber}&otherMailNoList=`;
                const cainiaoTab = await chrome.tabs.create({ url: cainiaoUrl, active: false });
                await new Promise(resolve => setTimeout(resolve, 4000));
                await new Promise(resolve => setTimeout(resolve, 2000));
                try {
                    const [{ result: statusText }] = await chrome.scripting.executeScript({
                        target: { tabId: cainiaoTab.id },
                        func: () => {
                            const el = document.querySelector('span.TrackingDetail--head--20GpNSP.TrackingDetail--headFirst--1mBxADn');
                            return el ? el.textContent.trim() : '';
                        }
                    });
                    if (statusText) {
                        trackingStatus = statusText;
                    } else {
                        // Nếu không lấy được status, kiểm tra thẻ warnning-text
                        const [{ result: warnText }] = await chrome.scripting.executeScript({
                            target: { tabId: cainiaoTab.id },
                            func: () => {
                                const warn = document.querySelector('div.warnning-text');
                                return warn ? warn.textContent.trim() : '';
                            }
                        });
                        if (warnText && warnText.includes('unusual traffic')) {
                            trackingStatus = 'Limit Traffic';
                        } else {
                            trackingStatus = 'Error';
                        }
                    }
                } catch (e) {
                    trackingStatus = 'Error';
                }
                await chrome.tabs.remove(cainiaoTab.id);
                // Log ra console và gửi về popup
                console.log(`Tracking status for ${trackingNumber}: ${trackingStatus}`);
                chrome.runtime.sendMessage({ type: 'TRACKING_STATUS', data: { orderId, trackingNumber, trackingStatus } });
            }
            // --- END tracking status ---
            
            // Update sheet
            currentTrackingStatus = { currentPage: i+1, totalItems: orderIds.length, status: `Updating tracking for orderId: ${orderId}...`, isTaskRunning: true };
            chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', data: currentTrackingStatus });
            
            // Sửa payload gửi lên API update
            const updatePayload = {
                id: sheetId,
                sheetName,
                orderId,
                trackingNumber,
                trackingStatus
            };
            const updateRes = await fetch(`${BASE_API_URL}/update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatePayload)
            });
            
            if (!updateRes.ok) {
                currentTrackingStatus = { currentPage: i+1, totalItems: orderIds.length, status: `Error updating orderId: ${orderId}`, isTaskRunning: true };
                chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', data: currentTrackingStatus });
            } else {
                currentTrackingStatus = { currentPage: i+1, totalItems: orderIds.length, status: `Updated tracking for orderId: ${orderId}`, isTaskRunning: true };
                chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', data: currentTrackingStatus });
            }
        }
        
        currentTrackingStatus = { currentPage: orderIds.length, totalItems: orderIds.length, status: 'All tracking numbers updated!', isTaskRunning: false };
        isTaskRunning = false;
        chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', data: currentTrackingStatus });
        
    } catch (error) {
        currentTrackingStatus = { currentPage: 0, totalItems: 0, status: 'Error: ' + error.message, isTaskRunning: false };
        isTaskRunning = false;
        chrome.runtime.sendMessage({ type: 'CRAWL_ERROR', error: error.message });
        chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', data: currentTrackingStatus });
    }
}