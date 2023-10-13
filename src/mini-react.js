let wipRoot = null; //wipRoot是当前组件的根（虚拟节点的）
let nextUnitOfWork = null; //在 render 阶段，开启每一个 unit 的工作
let currentRoot = null; //保存真实的DOM节点
let deletions = [];
let wipFiber; //wipFiber是整个应用的 根，wipRoot是当前组件的根，wipFiber包括wipRoot
let hookIndex = 0;
// Support React.Fragment syntax.
const Fragment = Symbol.for('react.fragment');

// Enhanced requestIdleCallback.
//requestIdle Callback，但是 React 并没有直接使用这个 API ，
//而是自行实现了一个功能更加完备的 requestIdleCallback 的 polyfill，也就是 Scheduler。(MessageChannel)
((global) => {
  const id = 1;
  const fps = 1e3 / 60;
  let frameDeadline;
  let pendingCallback;
  const channel = new MessageChannel();
  const timeRemaining = () => frameDeadline - window.performance.now();

  const deadline = {
    didTimeout: false,
    timeRemaining,
  };

  channel.port2.onmessage = () => {
    if (typeof pendingCallback === 'function') {
      pendingCallback(deadline);
    }
  };

  global.requestIdleCallback = (callback) => {
    global.requestAnimationFrame((frameTime) => {
      frameDeadline = frameTime + fps;
      pendingCallback = callback;
      channel.port1.postMessage(null);
    });
    return id;
  };
})(window);

const isDef = (param) => param !== void 0 && param !== null;

const isPlainObject = (val) =>
  Object.prototype.toString.call(val) === '[object Object]' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(val));

// Simple judgment of virtual elements.
const isVirtualElement = (e) => typeof e === 'object';

// Text elements require special handling.
const createTextElement = (text) => ({
  type: 'TEXT',
  props: {
    nodeValue: text,
    children: [],
  },
});

// Create custom JavaScript data structures.
//* Step 1: The createElement Function
const createElement = (type, props = {}, ...child) => {
  const children = child.map((c) =>
    isVirtualElement(c) ? c : createTextElement(String(c)),
  );

  return {
    type,
    props: {
      ...props,
      children,
    },
  };
};

// Update DOM properties.
// For simplicity, we remove all the previous properties and add next properties.
const updateDOM = (DOM, prevProps, nextProps) => {
  const defaultPropKeys = 'children';

  for (const [removePropKey, removePropValue] of Object.entries(prevProps)) {
    if (removePropKey.startsWith('on')) {
      DOM.removeEventListener(
        removePropKey.slice(2).toLowerCase(),
        removePropValue,
      );
    } else if (removePropKey !== defaultPropKeys) {
      DOM[removePropKey] = '';
    }
  }

  for (const [addPropKey, addPropValue] of Object.entries(nextProps)) {
    if (addPropKey.startsWith('on')) {
      DOM.addEventListener(addPropKey.slice(2).toLowerCase(), addPropValue);
    } else if (addPropKey !== defaultPropKeys) {
      DOM[addPropKey] = addPropValue;
    }
  }
};

// Create DOM based on node type.
const createDOM = (fiberNode) => {
  const { type, props } = fiberNode;
  let DOM = null;

  if (type === 'TEXT') {
    DOM = document.createTextNode('');
  } else if (typeof type === 'string') {
    DOM = document.createElement(type);
  }

  // Update properties based on props after creation.
  if (DOM !== null) {
    updateDOM(DOM, {}, props);
  }

  return DOM;
};

// Change the DOM based on fiber node changes.
// Note that we must complete the comparison of all fiber nodes before commitRoot.
// The comparison of fiber nodes can be interrupted, but the commitRoot cannot be interrupted.
//* Step 4: diff完了操作真实DOM
const commitRoot = () => {
  const findParentFiber = (fiberNode) => {
    if (fiberNode) {
      let parentFiber = fiberNode.return;
      while (parentFiber && !parentFiber.dom) {
        parentFiber = parentFiber.return;
      }
      return parentFiber;
    }

    return null;
  };

  const commitDeletion = (parentDOM, DOM) => {
    if (isDef(parentDOM)) {
      parentDOM.removeChild(DOM);
    }
  };

  const commitReplacement = (parentDOM, DOM) => {
    if (isDef(parentDOM)) {
      parentDOM.appendChild(DOM);
    }
  };

  const commitWork = (fiberNode) => {
    if (fiberNode) {
      if (fiberNode.dom) {
        const parentFiber = findParentFiber(fiberNode);
        const parentDOM = parentFiber?.dom;
        switch (fiberNode.effectTag) {
          case 'REPLACEMENT': //插入新节点
            commitReplacement(parentDOM, fiberNode.dom);
            break;
          case 'UPDATE': //更新
            updateDOM(
              fiberNode.dom,
              fiberNode.alternate ? fiberNode.alternate.props : {},
              fiberNode.props,
            );
            break;
          default:
            break;
        }
      }

      commitWork(fiberNode.child); //操作孩子
      commitWork(fiberNode.sibling); //操作兄弟节点
    }
  };

  for (const deletion of deletions) {
    //删除无用的节点
    if (deletion.dom) {
      const parentFiber = findParentFiber(deletion);
      commitDeletion(parentFiber?.dom, deletion.dom);
    }
  }

  if (wipRoot !== null) {
    commitWork(wipRoot.child); //经过 commitWork 过的节点是真实DOM，那么就相当于是 alternate 属性
    currentRoot = wipRoot;
  }

  wipRoot = null;
};

// Reconcile the fiber nodes before and after, compare and record the differences.
//* 处理初次渲染和更新 DIFF
const reconcileChildren = (fiberNode, elements = []) => {
  //参数 fiberNode：每一个fiber单元(虚拟节点)
  let index = 0;
  let oldFiberNode = void 0;
  let prevSibling = void 0;
  const virtualElements = elements.flat(Infinity);

  if (fiberNode.alternate?.child) {
    oldFiberNode = fiberNode.alternate.child;
  }

  while (
    index < virtualElements.length ||
    typeof oldFiberNode !== 'undefined'
  ) {
    const virtualElement = virtualElements[index]; //真实的子节点
    let newFiber = void 0;
    const isSameType = Boolean(
      oldFiberNode &&
        virtualElement &&
        oldFiberNode.type === virtualElement.type,
    );

    if (isSameType && oldFiberNode) {
      // update the node
      newFiber = {
        type: oldFiberNode.type,
        dom: oldFiberNode.dom,
        alternate: oldFiberNode,
        props: virtualElement.props,
        return: fiberNode,
        effectTag: 'UPDATE',
      };
    }

    if (!isSameType && Boolean(virtualElement)) {
      // add this node
      newFiber = {
        type: virtualElement.type,
        dom: null,
        alternate: null,
        props: virtualElement.props,
        return: fiberNode,
        effectTag: 'REPLACEMENT',
      };
    }

    if (!isSameType && oldFiberNode) {
      // delete the oldFiber's node
      deletions.push(oldFiberNode);
    }

    if (oldFiberNode) {
      oldFiberNode = oldFiberNode.sibling;
    }

    if (index === 0) {
      fiberNode.child = newFiber;
    } else if (typeof prevSibling !== 'undefined') {
      prevSibling.sibling = newFiber;
    }

    prevSibling = newFiber;
    index += 1;
  }
};

// Execute each unit task and return to the next unit task.
// Different processing according to the type of fiber node.
//* Step 3.2: 执行每一个 unit 的工作
const performUnitOfWork = (fiberNode) => {
  // 每一个 performUnitOfWork 有三件事需要做
  //1. add the element to the DOM
  //2. create the fibers for the element’s children
  //3. select the next unit of work
  const { type } = fiberNode;

  switch (typeof type) {
    case 'function': {
      wipFiber = fiberNode;
      wipFiber.hooks = [];
      hookIndex = 0;
      let children;

      if (Object.getPrototypeOf(type).REACT_COMPONENT) {
        const C = type;
        const component = new C(fiberNode.props);
        const [state, setState] = useState(component.state);
        component.props = fiberNode.props;
        component.state = state;
        component.setState = setState;
        children = component.render?.bind(component)();
      } else {
        children = type(fiberNode.props);
      }
      reconcileChildren(fiberNode, [
        //不仅负责初始化也负责更新
        isVirtualElement(children)
          ? children
          : createTextElement(String(children)),
      ]);
      break;
    }

    case 'number':
    case 'string':
      if (!fiberNode.dom) {
        fiberNode.dom = createDOM(fiberNode); //如果是初次渲染，add the element to the DOM
      }
      reconcileChildren(fiberNode, fiberNode.props.children); //不仅负责初始化也负责更新
      break;

    case 'symbol':
      if (type === Fragment) {
        reconcileChildren(fiberNode, fiberNode.props.children);
      }
      break;

    default:
      if (typeof fiberNode.props !== 'undefined') {
        reconcileChildren(fiberNode, fiberNode.props.children);
      }
      break;
  }

  if (fiberNode.child) {
    return fiberNode.child; // 返回下一个 nextUnitOfWork
  }

  let nextFiberNode = fiberNode;

  while (typeof nextFiberNode !== 'undefined') {
    if (nextFiberNode.sibling) {
      return nextFiberNode.sibling; // 返回下一个 nextUnitOfWork
    }

    nextFiberNode = nextFiberNode.return; //相当于  nextFiber = nextFiber.parent （走完兄弟节点回到父节点）
  }

  return null;
};

// Use requestIdleCallback to query whether there is currently a unit task
// and determine whether the DOM needs to be updated.
//* Step 3.1: use requestIdleCallback to make a loop.
const workLoop = (deadline) => {
  // deadline.timeRemaining() 检测当前帧渲染的剩余时间，大于1ms就执行
  while (nextUnitOfWork && deadline.timeRemaining() > 1) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    // performUnitOfWork 不仅执行当前的 unitOfWork, 也返回下一个 nextUnitOfWork
  }

  if (!nextUnitOfWork && wipRoot) {
    // 如果没有nextUnitOfWork，说明 协调阶段（render）结束，进入 提交阶段（commit），即进行 DIFF 算法
    commitRoot();
  }

  window.requestIdleCallback(workLoop);
};

// Initial or reset.
//* Step 2: The render Function
const render = (element, container) => {
  currentRoot = null;
  wipRoot = {
    //* 设置 wipRoot 和 nextUnitOfWork
    type: 'div',
    dom: container,
    props: {
      children: [
        {
          ...element,
        },
      ],
    },
    alternate: currentRoot, //alternate 属性指向当前的真实DOM
  };
  nextUnitOfWork = wipRoot;
  deletions = [];
};

// Associate the hook with the fiber node.
function useState(initState) {
  const hook = wipFiber?.alternate?.hooks
    ? wipFiber.alternate.hooks[hookIndex]
    : {
        state: initState,
        queue: [],
      };

  while (hook.queue.length) {
    let newState = hook.queue.shift();
    if (isPlainObject(hook.state) && isPlainObject(newState)) {
      newState = { ...hook.state, ...newState };
    }
    if (isDef(newState)) {
      hook.state = newState;
    }
  }

  if (typeof wipFiber.hooks === 'undefined') {
    wipFiber.hooks = [];
  }

  wipFiber.hooks.push(hook);
  hookIndex += 1;

  const setState = (value) => {
    hook.queue.push(value);

    if (currentRoot) {
      wipRoot = {
        type: currentRoot.type,
        dom: currentRoot.dom,
        props: currentRoot.props,
        alternate: currentRoot,
      };
      nextUnitOfWork = wipRoot;
      deletions = [];
      currentRoot = null;
    }
  };

  return [hook.state, setState];
}

class Component {
  props;

  constructor(props) {
    this.props = props;
  }

  // Identify Component.
  static REACT_COMPONENT = true;
}

//? Start the engine!
//* Step 3.3: use requestIdleCallback to make a loop
void (function main() {
  window.requestIdleCallback(workLoop);
})();

export default (window.React = {
  createElement,
  render,
  useState,
  Component,
  Fragment,
});
