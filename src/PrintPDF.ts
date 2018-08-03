import * as JsPDF from 'jspdf';

export interface IPrintConfig {
  document?: Document;
  window?: Window;
}
function getBinary(url: string) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.overrideMimeType('text/plain; charset=x-user-defined');
  xhr.send(null);

  return xhr.responseText;
}

function base64Encode(str: string) {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const len = str.length;
  const out = [];
  let i = 0;
  let c1;
  let c2;
  let c3;
  while (i < len) {
    c1 = str.charCodeAt(i++) & 0xff;
    if (i === len) {
      out.push(CHARS.charAt(c1 >> 2));
      out.push(CHARS.charAt((c1 & 0x3) << 4));
      out.push('==');
      break;
    }
    c2 = str.charCodeAt(i++);
    if (i === len) {
      out.push(CHARS.charAt(c1 >> 2));
      out.push(CHARS.charAt(((c1 & 0x3) << 4) | ((c2 & 0xF0) >> 4)));
      out.push(CHARS.charAt((c2 & 0xF) << 2));
      out.push('=');
      break;
    }
    c3 = str.charCodeAt(i++);
    out.push(CHARS.charAt(c1 >> 2));
    out.push(CHARS.charAt(((c1 & 0x3) << 4) | ((c2 & 0xF0) >> 4)));
    out.push(CHARS.charAt(((c2 & 0xF) << 2) | ((c3 & 0xC0) >> 6)));
    out.push(CHARS.charAt(c3 & 0x3F));
  }

  return out.join('');
}

export class PrintPDF {
  private static readonly PSEUDO_ELEMENTS: string[] = [
    '::after',
    '::before',
    '::placeholder'
  ];

  private static readonly IGNORED_PROPERTIES: Set<string> = new Set<string>([
    'animation',
    'animation-delay',
    'animation-direction',
    'animation-duration',
    'animation-fill-mode',
    'animation-iteration',
    'animation-name',
    'animation-play-state: ',
    'animation-timing-function',
    'cursor'
  ]);

  private static readonly MIME_TYPES: {} = {
    woff: 'application/font-woff',
    woff2: 'application/font-woff',
    eot: 'application/vnd.ms-fontobject',
    ttf: 'application/font-sfnt',
    svg: 'image/svg+xml'

  };

  private static getMimeType(url: string) {
    const match = /\.([A-z0-9]+?)([?#]+.*)?$/gi.exec(url);
    if (!match) {
      return 'text/html';
    }

    return PrintPDF.MIME_TYPES[match[1].toLowerCase()];
  }

  private static zip<T>(...args: T[][]) {
    return args[0].map(({}: {}, i: number) => args.map((array: T[]) => array[i]));
  }

  private static flatMap<T, E>(elements: T[], callback: (t: T) => E[]): E[] {
    return elements.reduce((ys: E[], x: T) => {
      return ys.concat(callback.call(this, x));
    },                     [] as E[]);
  }

  private serializer: XMLSerializer;
  private doc: Document;
  private win: Window;
  private readonly element: HTMLElement;
  private uniqueCounter: number;

  constructor(element: HTMLElement, cfg: IPrintConfig = {}) {
    this.serializer = new XMLSerializer();
    this.doc = cfg.document || document;
    this.win = cfg.window || window;
    this.element = element;
    this.uniqueCounter = 0;
  }

  public getUniqueClassName(): string {
    this.uniqueCounter += 1;

    return `print-pdf-cn-${this.uniqueCounter}`;
  }

  public traverseNodes(o: HTMLElement, d: HTMLElement, applyFn: (n1: HTMLElement, n2: HTMLElement) => void) {
    applyFn(o, d);
    if (o && d) {
      const filteredSrc = Array.from(o.childNodes).filter((e: {}) => e instanceof HTMLElement);
      const filteredDst = Array.from(d.childNodes).filter((e: {}) => e instanceof HTMLElement);
      const srcNodes: HTMLElement[] = filteredSrc as HTMLElement[];
      const dstNodes: HTMLElement[]  = filteredDst as HTMLElement[];
      if (srcNodes && dstNodes && srcNodes.length === dstNodes.length) {
        PrintPDF.zip(srcNodes, dstNodes).forEach((v: [HTMLElement, HTMLElement]) =>
          this.traverseNodes(v[0], v[1], applyFn)
        );
      }
    }
  }

  public copyFontFaces(globalStyle: HTMLStyleElement) {
    const styleSheets = Array.from(this.doc.styleSheets);
    const cssRules = PrintPDF.flatMap(styleSheets, (s: CSSStyleSheet) => Array.from(s.cssRules));
    const ruleType = CSSRule.FONT_FACE_RULE;
    const ffRules: CSSRule[] = cssRules.filter((r: CSSRule) => r.type === ruleType);
    ffRules.forEach((r: CSSStyleRule) => {
      const styleProperties = Array.from(r.style);
      const styleText = styleProperties.map((property: string) => {
        const priority = r.style.getPropertyPriority(property);
        const importance = priority ? ' !important' : '';
        let propValue = r.style.getPropertyValue(property);
        const baseUrl = r.parentStyleSheet.href || this.element.ownerDocument.location.href;
        if (/url\(["']?[^)]+["']?\)/.test(propValue)) {
          propValue = propValue.replace(/url\(["']?(.+?)["']?\)/g, (__: string, match: string) => {
            const url = new URL(match, baseUrl).toString();
            const binary = getBinary(url);
            const encoded = base64Encode(binary);
            const mimeType = PrintPDF.getMimeType(url);

            return `url("data:${mimeType};base64,${encoded}")`;
          });
        }

        return `\t${property}: ${propValue}${importance};`;
      }).join('\n');
      const textNode = this.doc.createTextNode(`\n@font-face {\n${styleText}\n}\n`);
      globalStyle.appendChild(textNode);
    });
  }

  public copyPseudoElements(src: HTMLElement, dst: HTMLElement, globalStyle: HTMLStyleElement) {
    PrintPDF.PSEUDO_ELEMENTS.forEach((pStr: string) => {
      const computedStyle = this.win.getComputedStyle(src, pStr);

      const propertyNames = Array.from(computedStyle);
      const cssText = propertyNames.map((propertyName: string) => {
        const priority = computedStyle.getPropertyPriority(propertyName);
        const importance = priority ? ' !important' : '';
        const propValue = computedStyle.getPropertyValue(propertyName);

        return `\t${propertyName}: ${propValue}${importance};`;
      }).join('\n');
      const className = dst.className;
      const textNode = this.doc.createTextNode(`\n.${className}${pStr} {\n${cssText}\n}\n`);
      globalStyle.appendChild(textNode);
    });
  }

  public copyStyle(src: HTMLElement, dst: HTMLElement, globalStyle: HTMLStyleElement) {
    const computedStyle = this.win.getComputedStyle(src);
    const className = this.getUniqueClassName();
    dst.className = `${className}`;
    const propertyNames = Array.from(computedStyle);
    const cssText = propertyNames.filter((name: string) => !PrintPDF.IGNORED_PROPERTIES.has(name))
      .map((propertyName: string) => {
        const priority = computedStyle.getPropertyPriority(propertyName);

        const importance = priority ? ' !important' : '';
        const propValue = computedStyle.getPropertyValue(propertyName);

        return `${propertyName}: ${propValue}${importance};`;
      }).join('\n');
    const textNode = this.doc.createTextNode(`\n.${className} {\n${cssText}\n}\n`);
    globalStyle.appendChild(textNode);
  }

  public toPDF(callback?: (pdf: JsPDF) => void) {
    const element = this.element;
    const copyElement = document.importNode(element, true) as HTMLElement;
    copyElement.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    const ceComputedStyle = this.win.getComputedStyle(element);
    let width = element.clientWidth;
    let height = element.clientHeight;
    width += parseInt(ceComputedStyle.getPropertyValue('margin-left'), 10);
    width += parseInt(ceComputedStyle.getPropertyValue('margin-right'), 10);
    height += parseInt(ceComputedStyle.getPropertyValue('margin-top'), 10);
    height += parseInt(ceComputedStyle.getPropertyValue('margin-bottom'), 10);

    const globalStyle = this.doc.createElement('style');
    globalStyle.type = 'text/css';
    this.copyFontFaces(globalStyle);

    this.traverseNodes(element, copyElement, (src: HTMLElement, dst: HTMLElement) => {
      dst.className = '';
      dst.removeAttribute('style');
      this.copyStyle(src, dst, globalStyle);
      this.copyPseudoElements(src, dst, globalStyle);
      ['scrollLeft', 'scrollTop', 'value'].forEach((prop: string) => {
        dst[prop] = src[prop];
      });
    });

    copyElement.appendChild(globalStyle);
    const serialized = this.serializer.serializeToString(copyElement);
    const foreignObject = `<foreignObject width='100%' height='100%'>${encodeURIComponent(serialized)}</foreignObject>`;
    const namespace = 'http://www.w3.org/2000/svg';
    const svgMarkup = `<svg xmlns='${namespace}' width='${width}' height='${height}'>${foreignObject}</svg>`;
    const xmlUri = `data:image/svg+xml,${svgMarkup}`;

    const img = new Image();
    const pdf = new JsPDF('l', 'pt', [width, height]);
    const w = Math.floor(pdf.internal.pageSize.getWidth());
    const h = Math.floor(pdf.internal.pageSize.getHeight());
    const tmpCanvas = this.doc.createElement('canvas');
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

  public printPDF() {
    this.toPDF((pdf: JsPDF) => {
      const fileURL = URL.createObjectURL(pdf.output('blob'));
      const win = window.open(fileURL, '_blank');
      win.focus();
    });
  }
}
