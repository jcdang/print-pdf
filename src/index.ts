import * as jsPDF from 'jspdf';

export default class PrintPDF {
    private static serializer = new XMLSerializer();
    private static zip() {
        return Array.from(arguments[0]).map((_, i) => Array.from(arguments).map(array => array[i]));
    }
    private static traverseNodes(o: HTMLElement,d: HTMLElement, applyFn: (n1: HTMLElement, n2: HTMLElement) => void) {
        applyFn(o, d);
        if (o && d && o.childNodes && d.childNodes && o.childNodes.length === d.childNodes.length) {
            (PrintPDF.zip as any)(o.childNodes, d.childNodes).forEach((v: [HTMLElement, HTMLElement]) =>
                PrintPDF.traverseNodes(v[0], v[1], applyFn)
            );
        }
    }
    public static toPDF(element: HTMLElement, callback?: (pdf: jsPDF) => void) {
        const copyElement = element.cloneNode(true) as HTMLElement;
        copyElement.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        const computedStyle = window.getComputedStyle(element)
        let width = element.clientWidth;
        let height = element.clientHeight;
        width += parseInt(computedStyle.getPropertyValue('margin-left'));
        width += parseInt(computedStyle.getPropertyValue('margin-right'));
        height += parseInt(computedStyle.getPropertyValue('margin-top'));
        height += parseInt(computedStyle.getPropertyValue('margin-bottom'));

        PrintPDF.traverseNodes(element, copyElement, (from, to) => {
            if (from instanceof HTMLElement) {
                const computedStyle = window.getComputedStyle(from);
                to.style.cssText = computedStyle.cssText;
                ['scrollLeft', 'scrollTop', 'value'].forEach(prop => {
                    to[prop] = from[prop];
                });
            }
        });
        
        const serialized = PrintPDF.serializer.serializeToString(copyElement);
        const xmlUri = `data:image/svg+xml,
        <svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>
            <foreignObject width='100%' height='100%'>
                ${serialized}
            </foreignObject> 
        </svg>`;

        const img = new Image();
        const pdf = new jsPDF("l", "pt", [width, height]);
        const w = Math.floor(pdf.internal.pageSize.getWidth());
        const h = Math.floor(pdf.internal.pageSize.getHeight());
        const tmpCanvas = document.createElement("canvas");
        const tmpCtx = tmpCanvas.getContext("2d");
        tmpCanvas.width = width;
        tmpCanvas.height = height;
        img.onload = () =>  {
            tmpCtx.drawImage(img, 0, 0)
            const dataURL = tmpCanvas.toDataURL("image/png");
            pdf.addImage(dataURL, "PNG", 0, 0, w, h);
            if (callback) {
                callback(pdf);
            }
        };
        img.src = xmlUri;
    }

    public static printPDF(element: HTMLElement) {
        PrintPDF.toPDF(element, (pdf) => {
            const fileURL = URL.createObjectURL(pdf.output("blob"));
            const win = window.open(fileURL, "_blank");
            win.focus();
        });
    }
}
