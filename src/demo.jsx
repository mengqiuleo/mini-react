import React from "./mini-react.js";

function Counter(props) {
  const [state, setState] = React.useState(1)

  const handleChange = () => {
    setState(state+1)
  }

  return (
    <div>
      <h2>{props.name}</h2>
      <div>Count: {state}</div>
      <button onClick={handleChange}>点击+1</button>
    </div>
  )
}

React.render(<Counter name={'zs'} />, document.getElementById('root'));
