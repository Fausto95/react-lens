import { configureStore, createSlice } from "@reduxjs/toolkit";
import { Provider, useDispatch, useSelector } from "react-redux";
import { registerStores, reduxAdapter, withTimeTravel } from "@reactlens/adapters";
import { Badge, Button, Card, Meta, Stack } from "@reactlens/demo-ui";

/**
 * Redux, the case that needs the app's cooperation: state only moves through a
 * reducer, so the rewind has to be let in. `withTimeTravel` is that one line —
 * and forgetting it is the failure the adapter reports loudly.
 */
const tasks = createSlice({
  name: "tasks",
  initialState: { done: [] as string[] },
  reducers: {
    complete: (state, action: { payload: string }) => {
      if (!state.done.includes(action.payload)) state.done.push(action.payload);
    },
    reset: (state) => {
      state.done = [];
    },
  },
});

const store = configureStore({
  // In production this is just `tasks.reducer` — the wrapper only exists so the
  // playhead has a way into the store.
  reducer: import.meta.env.DEV ? withTimeTravel(tasks.reducer) : tasks.reducer,
});

type TaskState = ReturnType<typeof store.getState>;

if (import.meta.env.DEV) {
  registerStores(reduxAdapter(store, { id: "tasks" }));
}

const ORDERS = ["Grind", "Tamp", "Brew"];

export function ReduxTasks() {
  return (
    <Provider store={store}>
      <TaskChecklist />
    </Provider>
  );
}
ReduxTasks.displayName = "ReduxTasks";

function TaskChecklist() {
  const done = useSelector((s: TaskState) => s.done);
  const dispatch = useDispatch();

  return (
    <Card>
      <Stack>
        <Meta>Redux Toolkit — root reducer wrapped with withTimeTravel.</Meta>
        <Stack row>
          {ORDERS.map((step) => (
            <Button
              key={step}
              size="sm"
              variant={done.includes(step) ? "primary" : "ghost"}
              onClick={() => dispatch(tasks.actions.complete(step))}
            >
              {step}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => dispatch(tasks.actions.reset())}>
            Reset
          </Button>
        </Stack>
        <Stack row>
          {done.length === 0 ? (
            <Meta>Nothing done yet</Meta>
          ) : (
            done.map((step) => <Badge key={step}>{step}</Badge>)
          )}
        </Stack>
      </Stack>
    </Card>
  );
}
TaskChecklist.displayName = "TaskChecklist";
