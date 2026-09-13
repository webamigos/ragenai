import { describe, it, expect } from 'vitest';

import { fileTypeFromName } from '../viewers/file-type-from-name';

/**
 * What a file name says it is.
 *
 * A cited source carries a file id and a name — the chunk payload never held a
 * type — so this is what decides which viewer opens in the chat. The knowledge
 * base does not use it: it has the real record.
 */
describe('fileTypeFromName', () => {
  it.each([
    ['umowa.pdf', 'PDF'],
    ['raport.docx', 'DOCX'],
    ['stary.doc', 'DOCX'],
    ['notatki.md', 'MARKDOWN'],
    ['notatki.markdown', 'MARKDOWN'],
    ['dane.csv', 'CSV'],
    ['dane.xlsx', 'XLSX'],
    ['opis.txt', 'TEXT'],
    ['ksiazka.epub', 'EPUB'],
    ['napisy.srt', 'SRT'],
    ['prezentacja.pptx', 'PPTX'],
    ['zdjecie.png', 'IMAGE'],
    ['zdjecie.jpeg', 'IMAGE'],
  ])('reads %s as %s', (name, expected) => {
    expect(fileTypeFromName(name)).toBe(expected);
  });

  it('ignores the case of the extension', () => {
    expect(fileTypeFromName('UMOWA.PDF')).toBe('PDF');
  });

  it('takes the last extension of a name with several', () => {
    expect(fileTypeFromName('archiwum.pdf.txt')).toBe('TEXT');
  });

  it('reads a name with no extension as unknown, not as text', () => {
    // The unsupported viewer offers a download, which is the right answer for
    // a file nothing here can render. Guessing TEXT would render binary.
    expect(fileTypeFromName('README')).toBe('UNKNOWN');
  });

  it('reads an extension it does not know as unknown', () => {
    expect(fileTypeFromName('archiwum.zip')).toBe('UNKNOWN');
  });

  it('reads a dotfile as unknown rather than by its name', () => {
    expect(fileTypeFromName('.gitignore')).toBe('UNKNOWN');
  });

  it('reads an empty name as unknown', () => {
    expect(fileTypeFromName('')).toBe('UNKNOWN');
  });
});
