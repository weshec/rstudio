/*
 * recreate-steps.ts
 *
 * Copyright (C) 2019-20 by RStudio, PBC
 * Copyright 2018 by Atypon Systems, LLC.
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

// typescript port of recreateTransform from https://gitlab.com/mpapp-public/prosemirror-recreate-steps
//
// original source file from Sept. 25, 2018 (initial commit of this file unmodified for comparison purposes):
// https://gitlab.com/mpapp-public/prosemirror-recreate-steps/-/blob/45c3c0c17823179e092f0cff6f11c9f4bd8554ab/src/recreate.js
//

import { Node as ProsemirrorNode, Schema } from 'prosemirror-model';
import { Transform, ReplaceStep, Step } from 'prosemirror-transform';

import { applyPatch, createPatch, Operation } from 'rfc6902';
import { ReplaceOperation } from 'rfc6902/diff';

import { diffWordsWithSpace, diffChars } from 'diff';

function getReplaceStep(fromDoc: ProsemirrorNode, toDoc: ProsemirrorNode) {
  let start = toDoc.content.findDiffStart(fromDoc.content);
  if (start === null || start === undefined) {
    return false;
  }

  const diffEnd = toDoc.content.findDiffEnd(fromDoc);
  if (diffEnd === null || diffEnd === undefined) {
    return false;
  }
  let { a: endA, b: endB } = diffEnd;

  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    if (
      // If there is an overlap, there is some freedom of choise in how to calculate the start/end boundary.
      // for an inserted/removed slice. We choose the extreme with the lowest depth value.
      fromDoc.resolve(start - overlap).depth < toDoc.resolve(endA + overlap).depth
    ) {
      start -= overlap;
    } else {
      endA += overlap;
      endB += overlap;
    }
  }
  return new ReplaceStep(start, endB, toDoc.slice(start, endA));
}

class RecreateTransform {
  private fromDoc: ProsemirrorNode;
  private toDoc: ProsemirrorNode;
  private complexSteps: boolean; // Whether to return steps other than ReplaceSteps
  private wordDiffs: boolean; // Whether to make text diffs cover entire words
  private schema: Schema;
  private tr: Transform;

  private currentJSON: { [key: string]: any };
  private finalJSON: { [key: string]: any };
  private ops: Operation[];

  constructor(fromDoc: ProsemirrorNode, toDoc: ProsemirrorNode, complexSteps: boolean, wordDiffs: boolean) {
    this.fromDoc = fromDoc;
    this.toDoc = toDoc;
    this.complexSteps = complexSteps;
    this.wordDiffs = wordDiffs;
    this.schema = fromDoc.type.schema;
    this.tr = new Transform(fromDoc);
    this.currentJSON = {};
    this.finalJSON = {};
    this.ops = [];
  }

  public init() {
    if (this.complexSteps) {
      // For First steps: we create versions of the documents without marks as
      // these will only confuse the diffing mechanism and marks won't cause
      // any mapping changes anyway.
      this.currentJSON = this.marklessDoc(this.fromDoc).toJSON();
      this.finalJSON = this.marklessDoc(this.toDoc).toJSON();
      this.ops = createPatch(this.currentJSON, this.finalJSON);
      this.recreateChangeContentSteps();
      this.recreateChangeMarkSteps();
    } else {
      // We don't differentiate between mark changes and other changes.
      this.currentJSON = this.fromDoc.toJSON();
      this.finalJSON = this.toDoc.toJSON();
      this.ops = createPatch(this.currentJSON, this.finalJSON);
      this.recreateChangeContentSteps();
    }

    this.simplifyTr();
    return this.tr;
  }

  private recreateChangeContentSteps() {
    // First step: find content changing steps.
    let ops = [];
    while (this.ops.length) {
      let op = this.ops.shift()!;
      let toDoc: ProsemirrorNode | false = false;
      const afterStepJSON = JSON.parse(JSON.stringify(this.currentJSON));
      const pathParts = op.path.split('/');
      ops.push(op);
      while (!toDoc) {
        applyPatch(afterStepJSON, [op]);
        try {
          toDoc = this.schema.nodeFromJSON(afterStepJSON);
          toDoc.check();
        } catch (error) {
          toDoc = false;
          if (this.ops.length) {
            op = this.ops.shift()!;
            ops.push(op);
          } else {
            throw new Error('No valid diff possible!');
          }
        }
      }
      if (this.complexSteps && ops.length === 1 && (pathParts.includes('attrs') || pathParts.includes('type'))) {
        // Node markup is changing
        this.addSetNodeMarkup();
        ops = [];
      } else if (ops.length === 1 && op.op === 'replace' && pathParts[pathParts.length - 1] === 'text') {
        // Text is being replaced, we apply text diffing to find the smallest possible diffs.
        this.addReplaceTextSteps(op as ReplaceOperation, afterStepJSON);
        ops = [];
      } else {
        if (this.addReplaceStep(toDoc, afterStepJSON)) {
          ops = [];
        }
      }
    }
  }

  private recreateChangeMarkSteps() {
    // Now the documents should be the same, except their marks, so everything should map 1:1.
    // Second step: Iterate through the toDoc and make sure all marks are the same in tr.doc
    this.toDoc.descendants((tNode, tPos) => {
      if (!tNode.isInline) {
        return true;
      }

      this.tr.doc.nodesBetween(tPos, tPos + tNode.nodeSize, (fNode, fPos) => {
        if (!fNode.isInline) {
          return true;
        }
        const from = Math.max(tPos, fPos);
        const to = Math.min(tPos + tNode.nodeSize, fPos + fNode.nodeSize);
        fNode.marks.forEach(nodeMark => {
          if (!nodeMark.isInSet(tNode.marks)) {
            this.tr.removeMark(from, to, nodeMark);
          }
        });
        tNode.marks.forEach(nodeMark => {
          if (!nodeMark.isInSet(fNode.marks)) {
            this.tr.addMark(from, to, nodeMark);
          }
        });
      });
    });
  }

  private marklessDoc(doc: ProsemirrorNode) {
    const tr = new Transform(doc);
    tr.removeMark(0, doc.nodeSize - 2);
    return tr.doc;
  }

  // From http://prosemirror.net/examples/footnote/
  private addReplaceStep(toDoc: ProsemirrorNode, afterStepJSON: { [key: string]: any }) {
    const fromDoc = this.schema.nodeFromJSON(this.currentJSON);
    const step = getReplaceStep(fromDoc, toDoc);
    if (!step) {
      return false;
    } else if (!this.tr.maybeStep(step).failed) {
      this.currentJSON = afterStepJSON;
    } else {
      throw new Error('No valid step found.');
    }
  }

  private addSetNodeMarkup() {
    const fromDoc = this.schema.nodeFromJSON(this.currentJSON);
    const toDoc = this.schema.nodeFromJSON(this.finalJSON);
    const start = toDoc.content.findDiffStart(fromDoc.content);
    if (start !== null && start !== undefined) {
      const fromNode = fromDoc.nodeAt(start);
      const toNode = toDoc.nodeAt(start);
      if (fromNode && toNode) {
        this.tr.setNodeMarkup(
          start,
          fromNode.type === toNode.type ? undefined : toNode.type,
          toNode.attrs,
          toNode.marks,
        );
        this.currentJSON = this.marklessDoc(this.tr.doc).toJSON();
        // Setting the node markup may have invalidated more ops, so we calculate them again.
        this.ops = createPatch(this.currentJSON, this.finalJSON);
      }
    }
  }

  private addReplaceTextSteps(op: ReplaceOperation, afterStepJSON: { [key: string]: any }) {
    // We find the position number of the first character in the string
    const op1 = Object.assign({}, op, { value: 'xx' });
    const op2 = Object.assign({}, op, { value: 'yy' });

    const afterOP1JSON = JSON.parse(JSON.stringify(this.currentJSON));
    const afterOP2JSON = JSON.parse(JSON.stringify(this.currentJSON));
    const pathParts = op.path.split('/');

    let obj = this.currentJSON;

    applyPatch(afterOP1JSON, [op1]);
    applyPatch(afterOP2JSON, [op2]);

    const op1Doc = this.schema.nodeFromJSON(afterOP1JSON);
    const op2Doc = this.schema.nodeFromJSON(afterOP2JSON);

    let offset = op1Doc.content.findDiffStart(op2Doc.content)!;
    const marks = op1Doc.resolve(offset + 1).marks();

    pathParts.shift();

    while (pathParts.length) {
      const pathPart = pathParts.shift()!;
      obj = obj[pathPart];
    }

    const finalText = op.value;
    const currentText = (obj as unknown) as string;

    const textDiffs = this.wordDiffs ? diffWordsWithSpace(currentText, finalText) : diffChars(currentText, finalText);

    while (textDiffs.length) {
      const diff = textDiffs.shift()!;
      if (diff.added) {
        if (textDiffs.length && textDiffs[0].removed) {
          const nextDiff = textDiffs.shift()!;
          this.tr.replaceWith(
            offset,
            offset + nextDiff.value.length,
            this.schema.nodeFromJSON({ type: 'text', text: diff.value }).mark(marks),
          );
        } else {
          this.tr.insert(offset, this.schema.nodeFromJSON({ type: 'text', text: diff.value }).mark(marks));
        }
        offset += diff.value.length;
      } else if (diff.removed) {
        if (textDiffs.length && textDiffs[0].added) {
          const nextDiff = textDiffs.shift()!;
          this.tr.replaceWith(
            offset,
            offset + diff.value.length,
            this.schema.nodeFromJSON({ type: 'text', text: nextDiff.value }).mark(marks),
          );
          offset += nextDiff.value.length;
        } else {
          this.tr.delete(offset, offset + diff.value.length);
        }
      } else {
        offset += diff.value.length;
      }
    }
    this.currentJSON = afterStepJSON;
  }

  // join adjacent ReplaceSteps
  private simplifyTr() {
    if (!this.tr.steps.length) {
      return;
    }

    const newTr = new Transform(this.tr.docs[0]);
    const oldSteps = this.tr.steps.slice();
    while (oldSteps.length) {
      let step = oldSteps.shift()!;
      while (oldSteps.length && step.merge(oldSteps[0])) {
        const addedStep = oldSteps.shift()!;
        if (step instanceof ReplaceStep && addedStep instanceof ReplaceStep) {
          step = getReplaceStep(newTr.doc, addedStep.apply(step.apply(newTr.doc).doc!).doc!) as Step;
        } else {
          step = step.merge(addedStep) as Step;
        }
      }
      newTr.step(step);
    }
    this.tr = newTr;
  }
}

export function recreateTransform(
  fromDoc: ProsemirrorNode,
  toDoc: ProsemirrorNode,
  complexSteps = true,
  wordDiffs = false,
) {
  const recreator = new RecreateTransform(fromDoc, toDoc, complexSteps, wordDiffs);
  return recreator.init();
}
