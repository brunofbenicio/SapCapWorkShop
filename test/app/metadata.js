// Helpers to look at the annotations in the $metadata document (EDMX) of a service.

/**
 * The text between <Annotations Target="..."> and its end tag.
 *
 * @param {string} edmx the metadata document
 * @param {string} target for example benicio_1_04Srv.CustomerMessages or benicio_1_04Srv.CustomerMessages/messageCategory
 */
function targetOf(edmx, target) {
    const blocks = [...edmx.matchAll(new RegExp(`<Annotations Target="${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">([\\s\\S]*?)</Annotations>`, 'g'))];
    return blocks.map(block => block[1]).join('\n');
}

/**
 * The XML of one annotation (term and qualifier) inside the annotations of a target, including nested
 * annotations; undefined if there is none.
 *
 * @param {string} edmx the metadata document
 * @param {string} target see targetOf
 * @param {string} term for example UI.LineItem
 * @param {string} [qualifier] for example Priority
 */
function annotation(edmx, target, term, qualifier) {
    const text = targetOf(edmx, target);
    const qualified = qualifier ? ` Qualifier="${qualifier}"` : '';
    const start = text.search(new RegExp(`<Annotation Term="${term.replace('.', '\\.')}"${qualified}[ >/]`));
    if (start < 0) return undefined;

    // An <Annotation ...> opens (unless it ends with />), </Annotation> closes.
    let depth = 0;
    const opening = /<Annotation\s[^>]*?(\/?)>/y;
    for (let index = start; index < text.length;) {
        const nextOpen = text.indexOf('<Annotation', index);
        const nextClose = text.indexOf('</Annotation>', index);
        if (nextClose < 0) return undefined;
        if (nextOpen >= 0 && nextOpen < nextClose) {
            opening.lastIndex = nextOpen;
            const match = opening.exec(text);
            if (!match) return undefined;
            if (!match[1]) depth++;
            else if (depth === 0) return text.slice(start, opening.lastIndex);
            index = opening.lastIndex;
        } else {
            depth--;
            index = nextClose + '</Annotation>'.length;
            if (depth === 0) return text.slice(start, index);
        }
    }
    return undefined;
}

/** The values of all <Path> and PropertyPath/AnnotationPath attributes in a piece of XML. */
const paths = xml => [...xml.matchAll(/<(?:Property)?Path>([^<]+)<\/(?:Property)?Path>|(?:Path|PropertyPath|AnnotationPath)="([^"]+)"/g)].map(match => match[1] ?? match[2]);

module.exports = { targetOf, annotation, paths };
