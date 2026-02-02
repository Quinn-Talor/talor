const puppeteer = require('puppeteer');
const fs = require('fs');

async function generatePDF() {
    const browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: true
    });
    const page = await browser.newPage();
    
    const htmlContent = fs.readFileSync('阿里巴巴Agent开发工程师简历.html', 'utf8');
    
    await page.setContent(htmlContent, {
        waitUntil: 'networkidle0'
    });
    
    await page.pdf({
        path: '阿里巴巴Agent开发工程师简历.pdf',
        format: 'A4',
        printBackground: true,
        margin: {
            top: '2cm',
            right: '2cm',
            bottom: '2cm',
            left: '2cm'
        }
    });
    
    await browser.close();
    console.log('PDF generated: 阿里巴巴Agent开发工程师简历.pdf');
}

generatePDF().catch(console.error);