/*
 * input_rule.ts
 *
 * Copyright (C) 2019-20 by RStudio, PBC
 *
 * Unless you have received this program directly from RStudio pursuant
 * to the terms of a commercial license agreement with RStudio, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

import { EditorState } from "prosemirror-state";
import { Schema, MarkType } from "prosemirror-model";
import { InputRule } from "prosemirror-inputrules";

import { PandocMark, markIsActive } from "./mark";

export function markInputRule(regexp: RegExp, markType: MarkType, filter: MarkInputRuleFilter,  getAttrs?: ((match: string[]) => object) | object) {
  return new InputRule(regexp, (state: EditorState, match: string[], start: number, end: number) => {

    if (!filter(state, start, end)) {
      return null;
    }

    const attrs = getAttrs instanceof Function ? getAttrs(match) : getAttrs;
    const tr = state.tr;
    if (match[1]) {
      const textStart = start + match[0].indexOf(match[1]);
      const textEnd = textStart + match[1].length;
      if (textEnd < end) {
        tr.delete(textEnd, end);
      }
      if (textStart > start) {
        tr.delete(start, textStart);
      }
      end = start + match[1].length;
    }
    const mark = markType.create(attrs);
    tr.addMark(start, end, mark);
    tr.removeStoredMark(mark); // Do not continue with mark.
    return tr;
  });
}

export function delimiterMarkInputRule(
  delim: string, 
  markType: MarkType, 
  filter: MarkInputRuleFilter, 
  prefixMask?: string, 
  noEnclosingWhitespace?: boolean
) {
  
  // create distinct patterns depending on whether we allow enclosing whitespace
  const contentPattern = noEnclosingWhitespace
      ? `[^\\s${delim}][^${delim}]+[^\\s${delim}]|[^\\s${delim}]{1,2}`
      : `[^${delim}]+`;
  
  // if there is no prefix mask then this is simple regex we can pass to markInputRule
  if (!prefixMask) {
    const regexp = `(?:${delim})(${contentPattern})(?:${delim})$`;
    return markInputRule(new RegExp(regexp), markType, filter);

    // otherwise we need custom logic to get mark placement/eliding right
  } else {
    // validate that delim and mask are single characters (our logic for computing offsets
    // below depends on this assumption)
    const validateParam = (name: string, value: string) => {
      // validate mask
      function throwError() {
        throw new Error(`${name} must be a single characater`);
      }
      if (value.startsWith('\\')) {
        if (value.length !== 2) {
          throwError();
        }
      } else if (value.length !== 1) {
        throwError();
      }
    };
    validateParam('delim', delim);

    // build regex (this regex assumes that mask is one character)
    const regexp = `(?:^|[^${prefixMask}])(?:${delim})(${contentPattern})(?:${delim})$`;

    // return rule
    return new InputRule(new RegExp(regexp), (state: EditorState, match: string[], start: number, end: number) => {

      if (!filter(state, start, end)) {
        return null;
      }

      // init transaction
      const tr = state.tr;

      // compute offset for mask (should be zero if this was the beginning of a line,
      // in all other cases it would be 1). note we depend on the delimiter being
      // of size 1 here (this is enforced above)
      const kDelimSize = 1;
      const maskOffset = match[0].length - match[1].length - kDelimSize * 2;

      // position of text to be formatted
      const textStart = start + match[0].indexOf(match[1]);
      const textEnd = textStart + match[1].length;

      // remove trailing markdown
      tr.delete(textEnd, end);

      // update start/end to reflect the leading mask which we want to leave alone
      start = start + maskOffset;
      end = start + match[1].length;

      // remove leading markdown
      tr.delete(start, textStart);

      // add mark
      const mark = markType.create();
      tr.addMark(start, end, mark);

      // remove stored mark so typing continues w/o the mark
      tr.removeStoredMark(mark);

      // return transaction
      return tr;
    });
  }
}


export type MarkInputRuleFilter = (state: EditorState, from?: number, to?: number) => boolean;

export function markInputRuleFilter(schema: Schema, marks: readonly PandocMark[]) : MarkInputRuleFilter {
  
  const maskedMarkTypes = marksWithNoInputRules(schema, marks);
  
  return (state: EditorState, from?: number, to?: number) => {
    if (from !== undefined && to !== undefined && from !== to) {
      const marksInRange: MarkType[] = [];
      state.doc.nodesBetween(from, to, node => {
        node.marks.forEach(mark => marksInRange.push(mark.type));
      });
      return !marksInRange.some(markType => maskedMarkTypes.includes(markType));
    }
    if (from === undefined) {
      for (const markType of maskedMarkTypes) {
        if (markIsActive(state, markType)) {
          return false;
        }
      }
    }
    return true;
  };
}


function marksWithNoInputRules(schema: Schema, marks: readonly PandocMark[]) : MarkType[] {
  const disabledMarks: MarkType[] = [];
  marks.forEach((mark: PandocMark) => {
    if (mark.noInputRules) {
      disabledMarks.push(schema.marks[mark.name]);
    }
  });
  return disabledMarks;
}

