import { jsPDF } from "jspdf";
import { nanumGothicBase64 } from "./nanumGothicBase64";
import { nanumGothicBoldBase64 } from "./nanumGothicBoldBase64";

const extractText = (node: any): string => {
    if (node.type === 'text') return node.text;
    if (node.type === 'hardBreak') return '\n';
    if (node.content && Array.isArray(node.content)) {
        return node.content.map(extractText).join('');
    }
    return '';
};

export const generateAndDownloadPDF = async (titlePageData: any, documentJson: any) => {
    // A4 default, point units
    const doc = new jsPDF({
        orientation: "portrait",
        unit: "pt",
        format: "a4"
    });

    // 1. Register Font
    // Using 'Identity-H' is critical for jsPDF to correctly interpret UTF-8 Unicode characters (Korean)
    // Without it, the font relies on WinAnsiEncoding which scrambles non-latin characters.
    doc.addFileToVFS("NanumGothic.ttf", nanumGothicBase64);
    doc.addFont("NanumGothic.ttf", "NanumGothic", "normal", "Identity-H");

    doc.addFileToVFS("NanumGothicBold.ttf", nanumGothicBoldBase64);
    doc.addFont("NanumGothicBold.ttf", "NanumGothic", "bold", "Identity-H");

    doc.setFont("NanumGothic");

    const PAGE_HEIGHT = doc.internal.pageSize.getHeight();
    const PAGE_WIDTH = doc.internal.pageSize.getWidth();
    const MARGIN = 72; // 1 inch
    let cursorY = MARGIN;

    const addNewPage = () => {
        doc.addPage();
        cursorY = MARGIN;
        // add headers/footers to new page
        addHeaderFooter();
    };

    const addHeaderFooter = () => {
        const docAny = doc as any;
        const currentPage = docAny.internal.getNumberOfPages();
        if (currentPage === 1) return; // No header/footer on title page

        doc.setFontSize(9);
        doc.setTextColor(150);
        // Header
        doc.text("Kor Screenplay Writer", MARGIN, 40);

        // Footer (Wait to add page counts until end)
    };

    // --- 1. Title Page (Page 1) ---
    // Title positioned roughly 40% down the page and centered
    doc.setFontSize(28);
    doc.setTextColor(0);
    const titleText = titlePageData.title || "문서 제목 없음";
    doc.text(titleText, PAGE_WIDTH / 2, PAGE_HEIGHT * 0.4, { align: "center" });

    // Combine author and contact into a right-aligned block at the bottom
    doc.setFontSize(11);
    const infoLines: string[] = [];

    // If contact exists, it normally includes dates, version info, etc.
    if (titlePageData.contact) {
        // Split by newlines just in case they typed multiple lines
        const contactArr = titlePageData.contact.split('\n');
        infoLines.push(...contactArr);
    }
    if (titlePageData.author) {
        infoLines.push(titlePageData.author);
    }

    if (infoLines.length > 0) {
        const bottomMargin = 120;
        let infoY = PAGE_HEIGHT - bottomMargin - (infoLines.length * 15);

        infoLines.forEach(line => {
            doc.text(line.trim(), PAGE_WIDTH - MARGIN, infoY, { align: "right" });
            infoY += 16;
        });
    }

    // Move to page 2 for content
    addNewPage();

    // --- 2. Content Parse ---
    doc.setFontSize(11);
    doc.setTextColor(0);
    const LINE_HEIGHT = 16;
    const MAX_Y = PAGE_HEIGHT - MARGIN - 30; // Leave room for footer

    const printLines = (lines: string[], x: number, lineSpacing: number) => {
        for (let i = 0; i < lines.length; i++) {
            if (cursorY > MAX_Y) {
                addNewPage();
            }
            doc.text(lines[i], x, cursorY);
            cursorY += lineSpacing;
        }
    };

    if (documentJson && documentJson.content) {
        documentJson.content.forEach((node: any) => {
            if (node.type !== 'screenplayBlock') return;

            const format = node.attrs?.format || 'action';
            const rawText = extractText(node);

            if (!rawText.trim() && format !== 'dialogue') {
                cursorY += LINE_HEIGHT;
                if (cursorY > MAX_Y) addNewPage();
                return;
            }

            if (format === 'scene') {
                doc.setFont("NanumGothic", "bold");
                cursorY += LINE_HEIGHT * 1.5; // margin-top

                const lines = doc.splitTextToSize(rawText, PAGE_WIDTH - MARGIN * 2);
                printLines(lines, MARGIN, LINE_HEIGHT);
                doc.setFont("NanumGothic", "normal");

            } else if (format === 'action') {
                cursorY += LINE_HEIGHT * 1.5; // margin-top

                const lines = doc.splitTextToSize(rawText, PAGE_WIDTH - MARGIN * 2);
                const ACTION_LINE_HEIGHT = 22; // 11 * 2.0
                printLines(lines, MARGIN, ACTION_LINE_HEIGHT);
                cursorY += LINE_HEIGHT * 0.5; // margin-bottom

            } else if (format === 'dialogue') {
                if (cursorY > MAX_Y) addNewPage();

                const tabIndex = rawText.indexOf('\t');
                let character = rawText;
                let body = '';

                if (tabIndex !== -1) {
                    character = rawText.substring(0, tabIndex).trim();
                    body = rawText.substring(tabIndex + 1);
                }

                const indentWidth = 50; // character width block

                // Print Character Name
                doc.text(character, MARGIN, cursorY);

                // Print Body
                const lines = doc.splitTextToSize(body, PAGE_WIDTH - MARGIN * 2 - indentWidth);
                const DIALOGUE_LINE_HEIGHT = 22;

                if (lines.length > 0) {
                    printLines(lines, MARGIN + indentWidth, DIALOGUE_LINE_HEIGHT);
                } else {
                    cursorY += DIALOGUE_LINE_HEIGHT; // If empty body
                }
            }
        });
    }

    // Add Footers (Page numbering)
    const docAny = doc as any;
    const totalPages = docAny.internal.getNumberOfPages();
    for (let i = 2; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(9);
        doc.setTextColor(150);
        const text = `${i - 1} / ${totalPages - 1}`;
        doc.text(text, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 40, { align: "right" });
    }

    const fileName = titlePageData.title ? `${titlePageData.title}.pdf` : 'script.pdf';
    doc.save(fileName);
};
