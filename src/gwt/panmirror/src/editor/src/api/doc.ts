
/*
 * doc.ts
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

import { Node as ProsemirrorNode } from 'prosemirror-model';
import { Transform } from 'prosemirror-transform';
import { recreateTransform } from '../vendor/prosemirror-recreate-steps/recreate';
 
export function docTransform(docA: ProsemirrorNode, docB: ProsemirrorNode, reportError: (error: any) => void) : Transform {
  // first attempt to use prosemirror-recreate-steps. if that throws an exception 
  // (unexpected, but we didn't write this code so don't know what the failure 
  // modes could be) then fall back to replacing all top level nodes
  try {
    return recreateTransform(docA, docB);
  } catch(error) {
    reportError(error);
    const tr = new Transform(docA);
    let i = 0;
    tr.doc.descendants((node, pos) => {
      const mappedPos = tr.mapping.map(pos);
      tr.replaceRangeWith(mappedPos, mappedPos + node.nodeSize, docB.child(i));
      i++;
      return false;
    });
    return tr;
  }
}

