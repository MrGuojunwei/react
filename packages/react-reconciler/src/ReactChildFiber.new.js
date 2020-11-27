/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactElement} from 'shared/ReactElementType';
import type {ReactPortal} from 'shared/ReactTypes';
import type {BlockComponent} from 'react/src/ReactBlock';
import type {LazyComponent} from 'react/src/ReactLazy';
import type {Fiber} from './ReactInternalTypes';
import type {Lanes} from './ReactFiberLane';

import getComponentName from 'shared/getComponentName';
import {Deletion, Placement} from './ReactFiberFlags';
import {
  getIteratorFn,
  REACT_ELEMENT_TYPE,
  REACT_FRAGMENT_TYPE,
  REACT_PORTAL_TYPE,
  REACT_LAZY_TYPE,
  REACT_BLOCK_TYPE,
} from 'shared/ReactSymbols';
import {
  FunctionComponent,
  ClassComponent,
  HostText,
  HostPortal,
  ForwardRef,
  Fragment,
  SimpleMemoComponent,
  Block,
} from './ReactWorkTags';
import invariant from 'shared/invariant';
import {
  warnAboutStringRefs,
  enableBlocksAPI,
  enableLazyElements,
} from 'shared/ReactFeatureFlags';

import {
  createWorkInProgress,
  resetWorkInProgress,
  createFiberFromElement,
  createFiberFromFragment,
  createFiberFromText,
  createFiberFromPortal,
} from './ReactFiber.new';
import {emptyRefsObject} from './ReactFiberClassComponent.new';
import {isCompatibleFamilyForHotReloading} from './ReactFiberHotReloading.new';
import {StrictMode} from './ReactTypeOfMode';

let didWarnAboutMaps;
let didWarnAboutGenerators;
let didWarnAboutStringRefs;
let ownerHasKeyUseWarning;
let ownerHasFunctionTypeWarning;
let warnForMissingKey = (child: mixed, returnFiber: Fiber) => {};

if (__DEV__) {
  didWarnAboutMaps = false;
  didWarnAboutGenerators = false;
  didWarnAboutStringRefs = {};

  /**
   * Warn if there's no key explicitly set on dynamic arrays of children or
   * object keys are not valid. This allows us to keep track of children between
   * updates.
   */
  ownerHasKeyUseWarning = {};
  ownerHasFunctionTypeWarning = {};

  warnForMissingKey = (child: mixed, returnFiber: Fiber) => {
    if (child === null || typeof child !== 'object') {
      return;
    }
    if (!child._store || child._store.validated || child.key != null) {
      return;
    }
    invariant(
      typeof child._store === 'object',
      'React Component in warnForMissingKey should have a _store. ' +
        'This error is likely caused by a bug in React. Please file an issue.',
    );
    child._store.validated = true;

    const componentName = getComponentName(returnFiber.type) || 'Component';

    if (ownerHasKeyUseWarning[componentName]) {
      return;
    }
    ownerHasKeyUseWarning[componentName] = true;

    console.error(
      'Each child in a list should have a unique ' +
        '"key" prop. See https://reactjs.org/link/warning-keys for ' +
        'more information.',
    );
  };
}

const isArray = Array.isArray;

function coerceRef(
  returnFiber: Fiber,
  current: Fiber | null,
  element: ReactElement,
) {
  const mixedRef = element.ref;
  if (
    mixedRef !== null &&
    typeof mixedRef !== 'function' &&
    typeof mixedRef !== 'object'
  ) {
    if (__DEV__) {
      // TODO: Clean this up once we turn on the string ref warning for
      // everyone, because the strict mode case will no longer be relevant
      if (
        (returnFiber.mode & StrictMode || warnAboutStringRefs) &&
        // We warn in ReactElement.js if owner and self are equal for string refs
        // because these cannot be automatically converted to an arrow function
        // using a codemod. Therefore, we don't have to warn about string refs again.
        !(
          element._owner &&
          element._self &&
          element._owner.stateNode !== element._self
        )
      ) {
        const componentName = getComponentName(returnFiber.type) || 'Component';
        if (!didWarnAboutStringRefs[componentName]) {
          if (warnAboutStringRefs) {
            console.error(
              'Component "%s" contains the string ref "%s". Support for string refs ' +
                'will be removed in a future major release. We recommend using ' +
                'useRef() or createRef() instead. ' +
                'Learn more about using refs safely here: ' +
                'https://reactjs.org/link/strict-mode-string-ref',
              componentName,
              mixedRef,
            );
          } else {
            console.error(
              'A string ref, "%s", has been found within a strict mode tree. ' +
                'String refs are a source of potential bugs and should be avoided. ' +
                'We recommend using useRef() or createRef() instead. ' +
                'Learn more about using refs safely here: ' +
                'https://reactjs.org/link/strict-mode-string-ref',
              mixedRef,
            );
          }
          didWarnAboutStringRefs[componentName] = true;
        }
      }
    }

    if (element._owner) {
      const owner: ?Fiber = (element._owner: any);
      let inst;
      if (owner) {
        const ownerFiber = ((owner: any): Fiber);
        invariant(
          ownerFiber.tag === ClassComponent,
          'Function components cannot have string refs. ' +
            'We recommend using useRef() instead. ' +
            'Learn more about using refs safely here: ' +
            'https://reactjs.org/link/strict-mode-string-ref',
        );
        inst = ownerFiber.stateNode;
      }
      invariant(
        inst,
        'Missing owner for string ref %s. This error is likely caused by a ' +
          'bug in React. Please file an issue.',
        mixedRef,
      );
      const stringRef = '' + mixedRef;
      // Check if previous string ref matches new string ref
      if (
        current !== null &&
        current.ref !== null &&
        typeof current.ref === 'function' &&
        current.ref._stringRef === stringRef
      ) {
        return current.ref;
      }
      const ref = function(value) {
        let refs = inst.refs;
        if (refs === emptyRefsObject) {
          // This is a lazy pooled frozen object, so we need to initialize.
          refs = inst.refs = {};
        }
        if (value === null) {
          delete refs[stringRef];
        } else {
          refs[stringRef] = value;
        }
      };
      ref._stringRef = stringRef;
      return ref;
    } else {
      invariant(
        typeof mixedRef === 'string',
        'Expected ref to be a function, a string, an object returned by React.createRef(), or null.',
      );
      invariant(
        element._owner,
        'Element ref was specified as a string (%s) but no owner was set. This could happen for one of' +
          ' the following reasons:\n' +
          '1. You may be adding a ref to a function component\n' +
          "2. You may be adding a ref to a component that was not created inside a component's render method\n" +
          '3. You have multiple copies of React loaded\n' +
          'See https://reactjs.org/link/refs-must-have-owner for more information.',
        mixedRef,
      );
    }
  }
  return mixedRef;
}

function throwOnInvalidObjectType(returnFiber: Fiber, newChild: Object) {
  if (returnFiber.type !== 'textarea') {
    invariant(
      false,
      'Objects are not valid as a React child (found: %s). ' +
        'If you meant to render a collection of children, use an array ' +
        'instead.',
      Object.prototype.toString.call(newChild) === '[object Object]'
        ? 'object with keys {' + Object.keys(newChild).join(', ') + '}'
        : newChild,
    );
  }
}

function warnOnFunctionType(returnFiber: Fiber) {
  if (__DEV__) {
    const componentName = getComponentName(returnFiber.type) || 'Component';

    if (ownerHasFunctionTypeWarning[componentName]) {
      return;
    }
    ownerHasFunctionTypeWarning[componentName] = true;

    console.error(
      'Functions are not valid as a React child. This may happen if ' +
        'you return a Component instead of <Component /> from render. ' +
        'Or maybe you meant to call this function rather than return it.',
    );
  }
}

// We avoid inlining this to avoid potential deopts from using try/catch.
/** @noinline */
function resolveLazyType<T, P>(
  lazyComponent: LazyComponent<T, P>,
): LazyComponent<T, P> | T {
  try {
    // If we can, let's peek at the resulting type.
    const payload = lazyComponent._payload;
    const init = lazyComponent._init;
    return init(payload);
  } catch (x) {
    // Leave it in place and let it throw again in the begin phase.
    return lazyComponent;
  }
}

// This wrapper function exists because I expect to clone the code in each path
// to be able to optimize each path individually by branching early. This needs
// a compiler or we can do it manually. Helpers that don't need this branching
// live outside of this function.
function ChildReconciler(shouldTrackSideEffects) { // 第一次挂载时 参数为false 更新时 参数为true
  // deleteChild的作用就是将第二个参数放到returnFiber.deletions的数组中，returnFiber应该是父节点的Fiber，childToDelete是要被删除的子节点的Fiber
  function deleteChild(returnFiber: Fiber, childToDelete: Fiber): void {
    if (!shouldTrackSideEffects) {
      // 如果时第一次挂载  不需要做任何处理
      // Noop.
      return;
    }
    const deletions = returnFiber.deletions;
    if (deletions === null) {
      returnFiber.deletions = [childToDelete];
      returnFiber.flags |= Deletion;
    } else {
      deletions.push(childToDelete);
    }
  }
  // deleteRemainingChildren的作用是，从第二个参数节点开始，将后面相邻的节点Fiber全部放入returnFiber.deletions的数组中
  function deleteRemainingChildren(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
  ): null {
    if (!shouldTrackSideEffects) {
      // Noop.
      return null;
    }

    // TODO: For the shouldClone case, this could be micro-optimized a bit by
    // assuming that after the first child we've already added everything.
    let childToDelete = currentFirstChild;
    while (childToDelete !== null) {
      deleteChild(returnFiber, childToDelete);
      childToDelete = childToDelete.sibling;
    }
    return null;
  }
  // mapRemainingChildren的作用是，从第二个参数节点开始，将后面相邻的节点以key: Fiber| index: Fiber的方式放入一个Map对象中，并返回这个Map对象
  // 通过这个map对象可以方便的判断新节点在老节点中是否存在
  function mapRemainingChildren(
    returnFiber: Fiber,
    currentFirstChild: Fiber,
  ): Map<string | number, Fiber> {
    // Add the remaining children to a temporary map so that we can find them by
    // keys quickly. Implicit (null) keys get added to this set with their index
    // instead.
    const existingChildren: Map<string | number, Fiber> = new Map();

    let existingChild = currentFirstChild;
    while (existingChild !== null) {
      if (existingChild.key !== null) {
        existingChildren.set(existingChild.key, existingChild);
      } else {
        existingChildren.set(existingChild.index, existingChild);
      }
      existingChild = existingChild.sibling;
    }
    return existingChildren;
  }
  // 首先，第一个参数fiber是当前渲染节点的fiber对象，useFiber的作用是如果fiber不为null，复用fiber的数据，将pendingProps替换为第二个参数，
  // 如果fiber为null,则创建一个fiber，这个fiber就是workInProgress，最终返回这个workInProgress， 并将workInProgress的index置为0，sibling为null，
  // 最后返回这个workInProgress
  function useFiber(fiber: Fiber, pendingProps: mixed): Fiber {
    // We currently set sibling to null and index to 0 here because it is easy
    // to forget to do before returning it. E.g. for the single child case.
    const clone = createWorkInProgress(fiber, pendingProps);
    clone.index = 0;
    clone.sibling = null;
    return clone;
  }
  // 处理节点移动情况的核心
  function placeChild(
    newFiber: Fiber,
    lastPlacedIndex: number,
    newIndex: number,
  ): number {
    newFiber.index = newIndex;
    if (!shouldTrackSideEffects) {
      // Noop.
      return lastPlacedIndex;
    }
    const current = newFiber.alternate;
    if (current !== null) {
      const oldIndex = current.index;
      if (oldIndex < lastPlacedIndex) {
        // This is a move.
        newFiber.flags = Placement;
        return lastPlacedIndex;
      } else {
        // This item can stay in place.
        return oldIndex;
      }
    } else {
      // This is an insertion.
      newFiber.flags = Placement;
      return lastPlacedIndex;
    }
  }
  // placeSingleChild的作用是当更新时,给newFiber打上Placement的标识,然后返回newFiber
  function placeSingleChild(newFiber: Fiber): Fiber {
    // This is simpler for the single child case. We only need to do a
    // placement for inserting new children.
    // 新创建的节点会添加flags表示
    if (shouldTrackSideEffects && newFiber.alternate === null) {
      newFiber.flags = Placement;
    }
    return newFiber;
  }

  // 更新文本节点，复用上次渲染的Fiber节点，更新pendingProps为textContent，并设置复用Fiber的return为returnFiber; 返回复用的Fiber节点
  function updateTextNode(
    returnFiber: Fiber,
    current: Fiber | null,
    textContent: string,
    lanes: Lanes,
  ) {
    if (current === null || current.tag !== HostText) {
      // Insert
      const created = createFiberFromText(textContent, returnFiber.mode, lanes);
      created.return = returnFiber;
      return created;
    } else {
      // Update
      const existing = useFiber(current, textContent);
      existing.return = returnFiber;
      return existing;
    }
  }
  // 更新元素节点
  function updateElement(
    returnFiber: Fiber, // 父节点的fiber
    current: Fiber | null, // 当前渲染节点的fiber
    element: ReactElement, // react元素
    lanes: Lanes, // 优先级相关
  ): Fiber {
    if (current !== null) {
      if (
        current.elementType === element.type ||
        // Keep this check inline so it only runs on the false path:
        (__DEV__ ? isCompatibleFamilyForHotReloading(current, element) : false)
      ) {
        // 当前渲染的节点类型与要更新的节点类型相同
        // Move based on index
        const existing = useFiber(current, element.props); // 复用当前渲染节点的fiber对象
        existing.ref = coerceRef(returnFiber, current, element); // 更改fiber对象的ref和return属性
        existing.return = returnFiber;
        if (__DEV__) {
          existing._debugSource = element._source;
          existing._debugOwner = element._owner;
        }
        return existing; // 返回复用的fiber对象
      } else if (enableBlocksAPI && current.tag === Block) {
        // The new Block might not be initialized yet. We need to initialize
        // it in case initializing it turns out it would match.
        let type = element.type;
        if (type.$$typeof === REACT_LAZY_TYPE) {
          type = resolveLazyType(type); // return type._init(type._payload)
        }
        if (
          type.$$typeof === REACT_BLOCK_TYPE &&
          ((type: any): BlockComponent<any, any>)._render ===
            (current.type: BlockComponent<any, any>)._render
        ) {
          // 如果type._render === current.type._render一致，执行此逻辑
          // Same as above but also update the .type field.
          // 复用当前渲染元素的fiber节点, 修改return和type属性
          const existing = useFiber(current, element.props);
          existing.return = returnFiber;
          existing.type = type;
          if (__DEV__) {
            existing._debugSource = element._source;
            existing._debugOwner = element._owner;
          }
          return existing;
        }
      }
    }
    // Insert
    //
    const created = createFiberFromElement(element, returnFiber.mode, lanes);
    created.ref = coerceRef(returnFiber, current, element);
    created.return = returnFiber;
    return created;
  }

  function updatePortal(
    returnFiber: Fiber,
    current: Fiber | null,
    portal: ReactPortal,
    lanes: Lanes,
  ): Fiber {
    if (
      current === null ||
      current.tag !== HostPortal ||
      current.stateNode.containerInfo !== portal.containerInfo ||
      current.stateNode.implementation !== portal.implementation
    ) {
      // Insert
      const created = createFiberFromPortal(portal, returnFiber.mode, lanes);
      created.return = returnFiber;
      return created;
    } else {
      // Update
      const existing = useFiber(current, portal.children || []);
      existing.return = returnFiber;
      return existing;
    }
  }

  function updateFragment(
    returnFiber: Fiber,
    current: Fiber | null,
    fragment: Iterable<*>,
    lanes: Lanes,
    key: null | string,
  ): Fiber {
    if (current === null || current.tag !== Fragment) {
      // Insert
      const created = createFiberFromFragment(
        fragment,
        returnFiber.mode,
        lanes,
        key,
      );
      created.return = returnFiber;
      return created;
    } else {
      // Update
      const existing = useFiber(current, fragment);
      existing.return = returnFiber;
      return existing;
    }
  }

  function createChild(
    returnFiber: Fiber,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    if (typeof newChild === 'string' || typeof newChild === 'number') {
      // Text nodes don't have keys. If the previous node is implicitly keyed
      // we can continue to replace it without aborting even if it is not a text
      // node.
      const created = createFiberFromText(
        '' + newChild,
        returnFiber.mode,
        lanes,
      );
      created.return = returnFiber;
      return created;
    }

    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          const created = createFiberFromElement(
            newChild,
            returnFiber.mode,
            lanes,
          );
          created.ref = coerceRef(returnFiber, null, newChild);
          created.return = returnFiber;
          return created;
        }
        case REACT_PORTAL_TYPE: {
          const created = createFiberFromPortal(
            newChild,
            returnFiber.mode,
            lanes,
          );
          created.return = returnFiber;
          return created;
        }
        case REACT_LAZY_TYPE: {
          if (enableLazyElements) {
            const payload = newChild._payload;
            const init = newChild._init;
            return createChild(returnFiber, init(payload), lanes);
          }
        }
      }

      if (isArray(newChild) || getIteratorFn(newChild)) {
        const created = createFiberFromFragment(
          newChild,
          returnFiber.mode,
          lanes,
          null,
        );
        created.return = returnFiber;
        return created;
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber);
      }
    }

    return null;
  }
  // 比对新老节点，返回null表示不存在可复用的节点，否则返回可复用的节点
  function updateSlot(
    returnFiber: Fiber,
    oldFiber: Fiber | null,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    // Update the fiber if the keys match, otherwise return null.

    // 拿到旧的子节点的key属性
    const key = oldFiber !== null ? oldFiber.key : null;

    // 如果新节点是文本节点的情况
    if (typeof newChild === 'string' || typeof newChild === 'number') {
      // Text nodes don't have keys. If the previous node is implicitly keyed
      // we can continue to replace it without aborting even if it is not a text
      // node.
      if (key !== null) {
        // 如果旧节点的key存在，说明旧节点不是文本节点，则不能复用
        return null;
      }
      // 代码执行到这里，说明旧节点的key不存在，即旧节点也是文本节点，则更新旧节点的文本内容即可
      return updateTextNode(returnFiber, oldFiber, '' + newChild, lanes);
    }
    // 新节点是对象类型的情况
    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          // 新节点的key和旧节点的key一样
          if (newChild.key === key) {
            if (newChild.type === REACT_FRAGMENT_TYPE) {
              return updateFragment(
                returnFiber,
                oldFiber,
                newChild.props.children,
                lanes,
                key,
              );
            }
            return updateElement(returnFiber, oldFiber, newChild, lanes);
          } else {
            return null;
          }
        }
        case REACT_PORTAL_TYPE: {
          if (newChild.key === key) {
            return updatePortal(returnFiber, oldFiber, newChild, lanes);
          } else {
            return null;
          }
        }
        case REACT_LAZY_TYPE: {
          if (enableLazyElements) {
            const payload = newChild._payload;
            const init = newChild._init;
            return updateSlot(returnFiber, oldFiber, init(payload), lanes);
          }
        }
      }
      // 新节点是数组
      if (isArray(newChild) || getIteratorFn(newChild)) {
        if (key !== null) {
          // 旧节点是对象，则无法复用
          return null;
        }

        return updateFragment(returnFiber, oldFiber, newChild, lanes, null);
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber);
      }
    }

    return null;
  }
  // 从existingChildren中找到旧节点，如果可复用，返回更新后的节点，如果不可复用，返回null
  function updateFromMap(
    existingChildren: Map<string | number, Fiber>,
    returnFiber: Fiber,
    newIdx: number,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    // 如果新节点是文本节点，则通过existingChildren.get方法拿到旧节点，然后updateTextNode拿到新内容的节点
    if (typeof newChild === 'string' || typeof newChild === 'number') {
      // Text nodes don't have keys, so we neither have to check the old nor
      // new node for the key. If both are text nodes, they match.
      const matchedFiber = existingChildren.get(newIdx) || null;
      return updateTextNode(returnFiber, matchedFiber, '' + newChild, lanes);
    }

    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        // 新节点是元素节点
        case REACT_ELEMENT_TYPE: {
          // matchedFiber为匹配到的节点，如果可复用则为可复用的旧节点，如果不可复用，则为null
          const matchedFiber =
            existingChildren.get(
              newChild.key === null ? newIdx : newChild.key,
            ) || null;
          if (newChild.type === REACT_FRAGMENT_TYPE) {
            return updateFragment(
              returnFiber,
              matchedFiber,
              newChild.props.children,
              lanes,
              newChild.key,
            );
          }
          // 返回更新后的元素节点
          return updateElement(returnFiber, matchedFiber, newChild, lanes);
        }
        case REACT_PORTAL_TYPE: {
          const matchedFiber =
            existingChildren.get(
              newChild.key === null ? newIdx : newChild.key,
            ) || null;
          return updatePortal(returnFiber, matchedFiber, newChild, lanes);
        }
        case REACT_LAZY_TYPE:
          if (enableLazyElements) {
            const payload = newChild._payload;
            const init = newChild._init;
            return updateFromMap(
              existingChildren,
              returnFiber,
              newIdx,
              init(payload),
              lanes,
            );
          }
      }

      if (isArray(newChild) || getIteratorFn(newChild)) {
        const matchedFiber = existingChildren.get(newIdx) || null;
        return updateFragment(returnFiber, matchedFiber, newChild, lanes, null);
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber);
      }
    }

    return null;
  }

  /**
   * Warns if there is a duplicate or missing key
   */
  function warnOnInvalidKey(
    child: mixed,
    knownKeys: Set<string> | null,
    returnFiber: Fiber,
  ): Set<string> | null {
    if (__DEV__) {
      if (typeof child !== 'object' || child === null) {
        return knownKeys;
      }
      switch (child.$$typeof) {
        case REACT_ELEMENT_TYPE:
        case REACT_PORTAL_TYPE:
          warnForMissingKey(child, returnFiber);
          const key = child.key;
          if (typeof key !== 'string') {
            break;
          }
          if (knownKeys === null) {
            knownKeys = new Set();
            knownKeys.add(key);
            break;
          }
          if (!knownKeys.has(key)) {
            knownKeys.add(key);
            break;
          }
          console.error(
            'Encountered two children with the same key, `%s`. ' +
              'Keys should be unique so that components maintain their identity ' +
              'across updates. Non-unique keys may cause children to be ' +
              'duplicated and/or omitted — the behavior is unsupported and ' +
              'could change in a future version.',
            key,
          );
          break;
        case REACT_LAZY_TYPE:
          if (enableLazyElements) {
            const payload = child._payload;
            const init = (child._init: any);
            warnOnInvalidKey(init(payload), knownKeys, returnFiber);
            break;
          }
        // We intentionally fallthrough here if enableLazyElements is not on.
        // eslint-disable-next-lined no-fallthrough
        default:
          break;
      }
    }
    return knownKeys;
  }
  // 这个函数算是diff核心中的核心，新的子节点是多个
  function reconcileChildrenArray(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChildren: Array<*>,
    lanes: Lanes,
  ): Fiber | null {
    // This algorithm can't optimize by searching from both ends since we
    // don't have backpointers on fibers. I'm trying to see how far we can get
    // with that model. If it ends up not being worth the tradeoffs, we can
    // add it later.

    // Even with a two ended optimization, we'd want to optimize for the case
    // where there are few changes and brute force the comparison instead of
    // going for the Map. It'd like to explore hitting that path first in
    // forward-only mode and only go for the Map once we notice that we need
    // lots of look ahead. This doesn't handle reversal as well as two ended
    // search but that's unusual. Besides, for the two ended optimization to
    // work on Iterables, we'd need to copy the whole set.

    // In this first iteration, we'll just live with hitting the bad case
    // (adding everything to a Map) in for every insert/move.

    // If you change this code, also update reconcileChildrenIterator() which
    // uses the same algorithm.

    if (__DEV__) {
      // First, validate keys.
      let knownKeys = null;
      for (let i = 0; i < newChildren.length; i++) {
        const child = newChildren[i];
        knownKeys = warnOnInvalidKey(child, knownKeys, returnFiber);
      }
    }
    // 结果的第一个子节点，即头节点
    let resultingFirstChild: Fiber | null = null;
    let previousNewFiber: Fiber | null = null;
    // 当前渲染的第一个子节点
    let oldFiber = currentFirstChild;
    //
    let lastPlacedIndex = 0;
    // 新节点指针
    let newIdx = 0;
    // 下一个旧子节点
    let nextOldFiber = null;
    for (; oldFiber !== null && newIdx < newChildren.length; newIdx++) {
      // 旧子节点不为null，从0开始遍历新的子节点数组
      if (oldFiber.index > newIdx) {
        nextOldFiber = oldFiber;
        oldFiber = null;
      } else {
        nextOldFiber = oldFiber.sibling;
      }
      const newFiber = updateSlot(
        returnFiber,
        oldFiber,
        newChildren[newIdx],
        lanes,
      );
      if (newFiber === null) {
        // TODO: This breaks on empty slots like null children. That's
        // unfortunate because it triggers the slow path all the time. We need
        // a better way to communicate whether this was a miss or null,
        // boolean, undefined, etc.
        if (oldFiber === null) {
          oldFiber = nextOldFiber;
        }
        break;
      }
      if (shouldTrackSideEffects) {
        if (oldFiber && newFiber.alternate === null) {
          // We matched the slot, but we didn't reuse the existing fiber, so we
          // need to delete the existing child.
          deleteChild(returnFiber, oldFiber);
        }
      }
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
      if (previousNewFiber === null) {
        // TODO: Move out of the loop. This only happens for the first run.
        resultingFirstChild = newFiber;
      } else {
        // TODO: Defer siblings if we're not at the right index for this slot.
        // I.e. if we had null values before, then we want to defer this
        // for each null value. However, we also don't want to call updateSlot
        // with the previous one.
        previousNewFiber.sibling = newFiber;
      }
      previousNewFiber = newFiber;
      oldFiber = nextOldFiber;
    }
    // 新节点已经遍历完毕，则需要将剩下的老节点进行删除
    if (newIdx === newChildren.length) {
      // We've reached the end of the new children. We can delete the rest.
      deleteRemainingChildren(returnFiber, oldFiber);
      return resultingFirstChild;
    }
    // 老节点已经遍历完毕，遍历剩下的新节点进行创建
    if (oldFiber === null) {
      // If we don't have any more existing children we can choose a fast path
      // since the rest will all be insertions.
      for (; newIdx < newChildren.length; newIdx++) {
        const newFiber = createChild(returnFiber, newChildren[newIdx], lanes);
        if (newFiber === null) {
          continue;
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          // TODO: Move out of the loop. This only happens for the first run.
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
      return resultingFirstChild;
    }

    // Add all children to a key map for quick lookups.
    const existingChildren = mapRemainingChildren(returnFiber, oldFiber);

    // Keep scanning and use the map to restore deleted items as moves.
    for (; newIdx < newChildren.length; newIdx++) {
      const newFiber = updateFromMap(
        existingChildren,
        returnFiber,
        newIdx,
        newChildren[newIdx],
        lanes,
      );
      if (newFiber !== null) {
        // 表示存在可复用的节点
        if (shouldTrackSideEffects) {
          if (newFiber.alternate !== null) {
            // The new fiber is a work in progress, but if there exists a
            // current, that means that we reused the fiber. We need to delete
            // it from the child list so that we don't add it to the deletion
            // list.
            existingChildren.delete(
              newFiber.key === null ? newIdx : newFiber.key,
            );
          }
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
    }

    if (shouldTrackSideEffects) {
      // Any existing children that weren't consumed above were deleted. We need
      // to add them to the deletion list.
      // 删除不可复用的旧节点
      existingChildren.forEach(child => deleteChild(returnFiber, child));
    }

    return resultingFirstChild;
  }

  function reconcileChildrenIterator(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChildrenIterable: Iterable<*>,
    lanes: Lanes,
  ): Fiber | null {
    // This is the same implementation as reconcileChildrenArray(),
    // but using the iterator instead.

    const iteratorFn = getIteratorFn(newChildrenIterable);
    invariant(
      typeof iteratorFn === 'function',
      'An object is not an iterable. This error is likely caused by a bug in ' +
        'React. Please file an issue.',
    );

    if (__DEV__) {
      // We don't support rendering Generators because it's a mutation.
      // See https://github.com/facebook/react/issues/12995
      if (
        typeof Symbol === 'function' &&
        // $FlowFixMe Flow doesn't know about toStringTag
        newChildrenIterable[Symbol.toStringTag] === 'Generator'
      ) {
        if (!didWarnAboutGenerators) {
          console.error(
            'Using Generators as children is unsupported and will likely yield ' +
              'unexpected results because enumerating a generator mutates it. ' +
              'You may convert it to an array with `Array.from()` or the ' +
              '`[...spread]` operator before rendering. Keep in mind ' +
              'you might need to polyfill these features for older browsers.',
          );
        }
        didWarnAboutGenerators = true;
      }

      // Warn about using Maps as children
      if ((newChildrenIterable: any).entries === iteratorFn) {
        if (!didWarnAboutMaps) {
          console.error(
            'Using Maps as children is not supported. ' +
              'Use an array of keyed ReactElements instead.',
          );
        }
        didWarnAboutMaps = true;
      }

      // First, validate keys.
      // We'll get a different iterator later for the main pass.
      const newChildren = iteratorFn.call(newChildrenIterable);
      if (newChildren) {
        let knownKeys = null;
        let step = newChildren.next();
        for (; !step.done; step = newChildren.next()) {
          const child = step.value;
          knownKeys = warnOnInvalidKey(child, knownKeys, returnFiber);
        }
      }
    }

    const newChildren = iteratorFn.call(newChildrenIterable);
    invariant(newChildren != null, 'An iterable object provided no iterator.');

    let resultingFirstChild: Fiber | null = null;
    let previousNewFiber: Fiber | null = null;

    let oldFiber = currentFirstChild;
    let lastPlacedIndex = 0;
    let newIdx = 0;
    let nextOldFiber = null;

    let step = newChildren.next();
    for (
      ;
      oldFiber !== null && !step.done;
      newIdx++, step = newChildren.next()
    ) {
      if (oldFiber.index > newIdx) {
        nextOldFiber = oldFiber;
        oldFiber = null;
      } else {
        nextOldFiber = oldFiber.sibling;
      }
      const newFiber = updateSlot(returnFiber, oldFiber, step.value, lanes);
      if (newFiber === null) {
        // TODO: This breaks on empty slots like null children. That's
        // unfortunate because it triggers the slow path all the time. We need
        // a better way to communicate whether this was a miss or null,
        // boolean, undefined, etc.
        if (oldFiber === null) {
          oldFiber = nextOldFiber;
        }
        break;
      }
      if (shouldTrackSideEffects) {
        if (oldFiber && newFiber.alternate === null) {
          // We matched the slot, but we didn't reuse the existing fiber, so we
          // need to delete the existing child.
          deleteChild(returnFiber, oldFiber);
        }
      }
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
      if (previousNewFiber === null) {
        // TODO: Move out of the loop. This only happens for the first run.
        resultingFirstChild = newFiber;
      } else {
        // TODO: Defer siblings if we're not at the right index for this slot.
        // I.e. if we had null values before, then we want to defer this
        // for each null value. However, we also don't want to call updateSlot
        // with the previous one.
        previousNewFiber.sibling = newFiber;
      }
      previousNewFiber = newFiber;
      oldFiber = nextOldFiber;
    }

    if (step.done) {
      // We've reached the end of the new children. We can delete the rest.
      deleteRemainingChildren(returnFiber, oldFiber);
      return resultingFirstChild;
    }

    if (oldFiber === null) {
      // If we don't have any more existing children we can choose a fast path
      // since the rest will all be insertions.
      for (; !step.done; newIdx++, step = newChildren.next()) {
        const newFiber = createChild(returnFiber, step.value, lanes);
        if (newFiber === null) {
          continue;
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          // TODO: Move out of the loop. This only happens for the first run.
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
      return resultingFirstChild;
    }

    // Add all children to a key map for quick lookups.
    const existingChildren = mapRemainingChildren(returnFiber, oldFiber);

    // Keep scanning and use the map to restore deleted items as moves.
    for (; !step.done; newIdx++, step = newChildren.next()) {
      const newFiber = updateFromMap(
        existingChildren,
        returnFiber,
        newIdx,
        step.value,
        lanes,
      );
      if (newFiber !== null) {
        if (shouldTrackSideEffects) {
          if (newFiber.alternate !== null) {
            // The new fiber is a work in progress, but if there exists a
            // current, that means that we reused the fiber. We need to delete
            // it from the child list so that we don't add it to the deletion
            // list.
            existingChildren.delete(
              newFiber.key === null ? newIdx : newFiber.key,
            );
          }
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
    }

    if (shouldTrackSideEffects) {
      // Any existing children that weren't consumed above were deleted. We need
      // to add them to the deletion list.
      existingChildren.forEach(child => deleteChild(returnFiber, child));
    }

    return resultingFirstChild;
  }
  // 新节点是个文本节点时
  function reconcileSingleTextNode(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    textContent: string,
    lanes: Lanes,
  ): Fiber {
    // There's no need to check for keys on text nodes since we don't have a
    // way to define them.
    // 旧节点的第一个节点也是一个文本节点,则复用旧节点
    if (currentFirstChild !== null && currentFirstChild.tag === HostText) {
      // We already have an existing node so let's just update it and delete
      // the rest.
      // 从第二个子节点开始,删除后面的节点
      deleteRemainingChildren(returnFiber, currentFirstChild.sibling);
      // 复用第一个子节点
      const existing = useFiber(currentFirstChild, textContent);
      existing.return = returnFiber;
      return existing;
    }
    // The existing first child is not a text node so we need to create one
    // and delete the existing ones.
    // 执行到这里说明旧节点的第一个节点不是文本节点,则先删除所有子节点,然后创建一个文本节点,并设置新节点的return属性为returnFiber
    deleteRemainingChildren(returnFiber, currentFirstChild);
    const created = createFiberFromText(textContent, returnFiber.mode, lanes);
    created.return = returnFiber;
    return created;
  }
  // 新的子节点是一个react元素类型,将会执行此函数
  /**
   * 总结一下这部分的逻辑：循环 直到child !== null 即首先判断是否存在旧的子节点，
   * 如果不存在，则判断新的子节点是否是Fragment节点，如果是,则创建Fragemnt类型的Fiber， 如果不是，则创建element类型的fiber
   * 如果存在，继续后面的判断
   * 判断新旧子节点的key是否一样，如果不一样，则删除当前处理的子节点，继续下一个相邻子节点
   * 如果key一样，进行后面的逻辑
   * 1.如果旧的当前子节点和新的子节点都是Fragment，删除后面的相邻子节点，复用当前子节点
   * 2.如果旧的当前子节点是Block类型，并且新的子节点是REACT_BLOCK_TYPE类型，删除后面的相邻子节点，复用当前子节点
   * 3.旧的当前子节点的类型和新的节点类型是同一类型，删除后面的相邻子节点，复用当前子节点
   * 该函数返回可复用的fiber，或者是新创建的fiber
   *
   */
  function reconcileSingleElement(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    element: ReactElement,
    lanes: Lanes,
  ): Fiber {
    const key = element.key; // 新元素的key属性
    let child = currentFirstChild; // 旧的第一个子节点
    while (child !== null) {
      // TODO: If key === null and child.key === null, then this only applies to
      // the first item in the list. 列表中的第一项
      if (child.key === key) { // 如果旧节点的key和新节点的key一致，要么都存在key且一致,要么都不存在key
        switch (child.tag) {
          case Fragment: {
            // 如果旧节点是Fragment节点，新节点也是Fragment，先删除该旧节点后面的元素。再通过useFiber复用该旧节点，返回复用后的节点
            // 如果旧节点是Fragment节点，新节点不是Fragment,跳出switch
            if (element.type === REACT_FRAGMENT_TYPE) {
              // 如果新的子节点和旧的子节点都是Fragment标签,删除旧的子节点后面的相邻节点
              deleteRemainingChildren(returnFiber, child.sibling);
              // 复用旧的子节点
              const existing = useFiber(child, element.props.children);
              existing.return = returnFiber;
              if (__DEV__) {
                existing._debugSource = element._source;
                existing._debugOwner = element._owner;
              }
              // 返回复用后的fiber
              return existing;
            }
            break;
          }
          case Block:
            if (enableBlocksAPI) {
              let type = element.type; // 拿到新元素的类型
              if (type.$$typeof === REACT_LAZY_TYPE) {
                // 判断是否是REACT_LAZY_TYPE类型，如果新节点是懒加载类型，交由resolveLazyType去处理
                type = resolveLazyType(type);
              }
              if (type.$$typeof === REACT_BLOCK_TYPE) { // 新元素是REACT_BLOCK_TYPE
                // The new Block might not be initialized yet. We need to initialize
                // it in case initializing it turns out it would match.
                if (
                  ((type: any): BlockComponent<any, any>)._render ===
                  (child.type: BlockComponent<any, any>)._render
                ) {
                  // 新元素的type._render === child.tyep._type,则
                  // 首先删除剩下的子节点, 并非真正意义上的删除,只是将要删除的节点添加到returnFiber.deletions中了,在提交阶段进行真正的删除
                  deleteRemainingChildren(returnFiber, child.sibling);
                  // 复用当前渲染的fiber节点
                  const existing = useFiber(child, element.props);
                  existing.type = type;
                  existing.return = returnFiber;
                  if (__DEV__) {
                    existing._debugSource = element._source;
                    existing._debugOwner = element._owner;
                  }
                  return existing;
                }
              }
            }
          // We intentionally fallthrough here if enableBlocksAPI is not on.
          // eslint-disable-next-lined no-fallthrough
          default: {
            // 判断新节点类型和旧节点类型是否一样,如果一样,则复用子节点
            if (
              child.elementType === element.type ||
              // Keep this check inline so it only runs on the false path:
              (__DEV__
                ? isCompatibleFamilyForHotReloading(child, element)
                : false)
            ) {
              // 首先删除剩下的子节点
              deleteRemainingChildren(returnFiber, child.sibling);
              // 复用已经渲染的fiber节点
              const existing = useFiber(child, element.props);
              // 更新复用节点的ref属性和return属性
              existing.ref = coerceRef(returnFiber, child, element);
              existing.return = returnFiber;
              if (__DEV__) {
                existing._debugSource = element._source;
                existing._debugOwner = element._owner;
              }
              return existing;
            }
            break;
          }
        }
        // Didn't match.
        // 从当前操作的旧节点开始，删除后面的所有节点
        deleteRemainingChildren(returnFiber, child);
        break;
      } else {
        // key不相同,表示不可复用,则删除该子节点,继续处理后面的子节点
        deleteChild(returnFiber, child);
      }
      child = child.sibling; // 处理后面的子节点
    }
    // 代码执行到此，说明旧节点的子节点为null，则意味着添加新的元素
    // 如果新的元素是Fragment类型
    if (element.type === REACT_FRAGMENT_TYPE) {
      // 则创建Fragment节点的fiber
      const created = createFiberFromFragment(
        element.props.children,
        returnFiber.mode,
        lanes,
        element.key,
      );
      created.return = returnFiber;
      return created;
    } else {
      // 创建元素节点类型的fiber并返回
      const created = createFiberFromElement(element, returnFiber.mode, lanes);
      created.ref = coerceRef(returnFiber, currentFirstChild, element);
      created.return = returnFiber;
      return created;
    }
  }

  function reconcileSinglePortal(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    portal: ReactPortal,
    lanes: Lanes,
  ): Fiber {
    const key = portal.key;
    let child = currentFirstChild;
    while (child !== null) {
      // TODO: If key === null and child.key === null, then this only applies to
      // the first item in the list.
      if (child.key === key) {
        if (
          child.tag === HostPortal &&
          child.stateNode.containerInfo === portal.containerInfo &&
          child.stateNode.implementation === portal.implementation
        ) {
          deleteRemainingChildren(returnFiber, child.sibling);
          const existing = useFiber(child, portal.children || []);
          existing.return = returnFiber;
          return existing;
        } else {
          deleteRemainingChildren(returnFiber, child);
          break;
        }
      } else {
        deleteChild(returnFiber, child);
      }
      child = child.sibling;
    }

    const created = createFiberFromPortal(portal, returnFiber.mode, lanes);
    created.return = returnFiber;
    return created;
  }

  // This API will tag the children with the side-effect of the reconciliation
  // itself. They will be added to the side-effect list as we pass through the
  // children and the parent.
  // Diff算法的核心逻辑都在这个函数中
  function reconcileChildFibers(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    // This function is not recursive.
    // If the top level item is an array, we treat it as a set of children,
    // not as a fragment. Nested arrays on the other hand will be treated as
    // fragment nodes. Recursion happens at the normal flow.

    // Handle top level unkeyed fragments as if they were arrays.
    // This leads to an ambiguity between <>{[...]}</> and <>...</>.
    // We treat the ambiguous cases above the same.
    // 如果newChild是Fragment标签, 则将其children作为一个集合数组，并赋值给newChild
    const isUnkeyedTopLevelFragment =
      typeof newChild === 'object' &&
      newChild !== null &&
      newChild.type === REACT_FRAGMENT_TYPE &&
      newChild.key === null;
    if (isUnkeyedTopLevelFragment) {
      newChild = newChild.props.children;
    }

    // Handle object types
    // 如果newChild是一个对象类型的
    const isObject = typeof newChild === 'object' && newChild !== null;
    // 处理对象类型
    // 新的子节点是对象，表明新的子节点是单个元素，新的子节点是元素类型
    if (isObject) {
      // newChild.$$typeof存在，表示新节点是一个react元素
      switch (newChild.$$typeof) {
        // 新的子节点是react_element类型，普通react元素
        case REACT_ELEMENT_TYPE:
          return placeSingleChild(
            // 调和单个元素，已知新节点为单个react元素,返回结果要么是被复用的节点，要么是无可复用节点而新创建的节点
            reconcileSingleElement(
              returnFiber,
              currentFirstChild,
              newChild,
              lanes,
            ),
          );
          // 新的子节点是react portal类型
        case REACT_PORTAL_TYPE:
          return placeSingleChild(
            reconcileSinglePortal(
              returnFiber,
              currentFirstChild,
              newChild,
              lanes,
            ),
          );
          // 新的子节点是react 懒加载类型
        case REACT_LAZY_TYPE:
          if (enableLazyElements) {
            const payload = newChild._payload;
            const init = newChild._init;
            // TODO: This function is supposed to be non-recursive.
            return reconcileChildFibers(
              returnFiber,
              currentFirstChild,
              init(payload),
              lanes,
            );
          }
      }
    }
    // 新的子节点是文本或数字类型,判断旧节点的第一个子节点是否时文本节点,如果是则复用,并删除剩下的子节点,如果不是,删除所有子节点,创建文本节点
    if (typeof newChild === 'string' || typeof newChild === 'number') {
      return placeSingleChild(
        reconcileSingleTextNode(
          returnFiber,
          currentFirstChild,
          '' + newChild,
          lanes,
        ),
      );
    }
    // 新的子节点不是单个,而是多个,则进行多个子元素下的diff比对
    if (isArray(newChild)) {
      return reconcileChildrenArray(
        returnFiber,
        currentFirstChild,
        newChild,
        lanes,
      );
    }

    if (getIteratorFn(newChild)) {
      return reconcileChildrenIterator(
        returnFiber,
        currentFirstChild,
        newChild,
        lanes,
      );
    }
    // newChild是对象类型,又不是REACT_ELEMENT_TYPE/REACT_PORTAL_TYPE/REACT_LAZY_TYPE这三种类型的,则抛出错误
    if (isObject) {
      throwOnInvalidObjectType(returnFiber, newChild);
    }
    // newChild是函数类型
    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber);
      }
    }
    if (typeof newChild === 'undefined' && !isUnkeyedTopLevelFragment) {
      // If the new child is undefined, and the return fiber is a composite
      // component, throw an error. If Fiber return types are disabled,
      // we already threw above.
      switch (returnFiber.tag) {
        case ClassComponent: {
          if (__DEV__) {
            const instance = returnFiber.stateNode;
            if (instance.render._isMockFunction) {
              // We allow auto-mocks to proceed as if they're returning null.
              break;
            }
          }
        }
        // Intentionally fall through to the next case, which handles both
        // functions and classes
        // eslint-disable-next-lined no-fallthrough
        case Block:
        case FunctionComponent:
        case ForwardRef:
        case SimpleMemoComponent: {
          invariant(
            false,
            '%s(...): Nothing was returned from render. This usually means a ' +
              'return statement is missing. Or, to render nothing, ' +
              'return null.',
            getComponentName(returnFiber.type) || 'Component',
          );
        }
      }
    }

    // Remaining cases are all treated as empty.
    // 删除剩下的子节点
    return deleteRemainingChildren(returnFiber, currentFirstChild);
  }

  return reconcileChildFibers;
}

export const reconcileChildFibers = ChildReconciler(true);
export const mountChildFibers = ChildReconciler(false);

export function cloneChildFibers(
  current: Fiber | null,
  workInProgress: Fiber,
): void {
  invariant(
    current === null || workInProgress.child === current.child,
    'Resuming work not yet implemented.',
  );

  if (workInProgress.child === null) {
    return;
  }

  let currentChild = workInProgress.child;
  let newChild = createWorkInProgress(currentChild, currentChild.pendingProps);
  workInProgress.child = newChild;

  newChild.return = workInProgress;
  while (currentChild.sibling !== null) {
    currentChild = currentChild.sibling;
    newChild = newChild.sibling = createWorkInProgress(
      currentChild,
      currentChild.pendingProps,
    );
    newChild.return = workInProgress;
  }
  newChild.sibling = null;
}

// Reset a workInProgress child set to prepare it for a second pass.
export function resetChildFibers(workInProgress: Fiber, lanes: Lanes): void {
  let child = workInProgress.child;
  while (child !== null) {
    resetWorkInProgress(child, lanes);
    child = child.sibling;
  }
}
