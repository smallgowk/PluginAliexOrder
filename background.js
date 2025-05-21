// Background script to handle continuous crawling
let isCrawling = false;
let currentTabId = null;
let crawledItemIds = new Set();

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