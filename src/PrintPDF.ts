import * as JsPDF from 'jspdf';

export class PrintPDF {
  private serializer: XMLSerializer;

  constructor() {
    this.serializer = new XMLSerializer();
  }

  private static zip(...args: HTMLElement[][]) {
    return args[0].map(({}: {}, i: number) => args.map((array: HTMLElement[]) => array[i]));
  }

  private static traverseNodes(o: HTMLElement, d: HTMLElement, applyFn: (n1: HTMLElement, n2: HTMLElement) => void) {
    applyFn(o, d);
    if (o && d) {
      const filteredSrc = Array.from(o.childNodes).filter((e: {}) => e instanceof HTMLElement);
      const filteredDst = Array.from(d.childNodes).filter((e: {}) => e instanceof HTMLElement);
      const srcNodes: HTMLElement[] = filteredSrc as HTMLElement[];
      const dstNodes: HTMLElement[]  = filteredDst as HTMLElement[];
      if (srcNodes && dstNodes && srcNodes.length === dstNodes.length) {
        PrintPDF.zip(srcNodes, dstNodes).forEach((v: [HTMLElement, HTMLElement]) =>
          PrintPDF.traverseNodes(v[0], v[1], applyFn)
        );
      }
    }
  }

  public toPDF(element: HTMLElement, callback?: (pdf: JsPDF) => void) {
    const copyElement = element.cloneNode(true) as HTMLElement;
    copyElement.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    const ceComputedStyle = window.getComputedStyle(element);
    let width = element.clientWidth;
    let height = element.clientHeight;
    width += parseInt(ceComputedStyle.getPropertyValue('margin-left'), 10);
    width += parseInt(ceComputedStyle.getPropertyValue('margin-right'), 10);
    height += parseInt(ceComputedStyle.getPropertyValue('margin-top'), 10);
    height += parseInt(ceComputedStyle.getPropertyValue('margin-bottom'), 10);

    PrintPDF.traverseNodes(element, copyElement, (src: HTMLElement, dst: HTMLElement) => {
      const computedStyle = window.getComputedStyle(src);
      dst.style.cssText = computedStyle.cssText;
      ['scrollLeft', 'scrollTop', 'value'].forEach((prop: string) => {
        dst[prop] = src[prop];
      });
    });

    const serialized = this.serializer.serializeToString(copyElement);
    const foreignObject = `<foreignObject width='100%' height='100%'>${serialized}</foreignObject>`;
    const namespace = 'http://www.w3.org/2000/svg';
    const svgMarkup = `<svg xmlns='${namespace}' width='${width}' height='${height}'>${foreignObject}</svg>`;
    const xmlUri = `data:image/svg+xml,${svgMarkup}`;

    const img = new Image();
    const pdf = new JsPDF('l', 'pt', [width, height]);
    const w = Math.floor(pdf.internal.pageSize.getWidth());
    const h = Math.floor(pdf.internal.pageSize.getHeight());
    const tmpCanvas = document.createElement('canvas');
    const tmpCtx = tmpCanvas.getContext('2d');
    tmpCanvas.width = width;
    tmpCanvas.height = height;
    img.onload = () =>  {
      tmpCtx.drawImage(img, 0, 0);
      const dataURL = tmpCanvas.toDataURL('image/png');
      pdf.addImage(dataURL, 'PNG', 0, 0, w, h);
      if (callback) {
        callback(pdf);
      }
    };
    img.src = xmlUri;
  }

  public printPDF(element: HTMLElement) {
    this.toPDF(element, (pdf: JsPDF) => {
      const fileURL = URL.createObjectURL(pdf.output('blob'));
      const win = window.open(fileURL, '_blank');
      win.focus();
    });
  }
}
