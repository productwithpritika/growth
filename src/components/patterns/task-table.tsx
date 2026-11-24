import { useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { LiveStatus } from "@/components/live-status";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Task = { id: string; name: string };

function taskCount(count: number) {
  return `${count} ${count === 1 ? "task" : "tasks"}.`;
}

// Opt-in local-state example, not a default page or a connector save boundary.
export function TaskTable({ initialTasks = [] }: { initialTasks?: Task[] }) {
  const [state, setState] = useState<{
    tasks: Task[];
    message: string;
    focusTarget?: { id: string | null };
  }>(() => {
    if (new Set(initialTasks.map((task) => task.id)).size !== initialTasks.length) {
      throw new Error("TaskTable requires unique initial task ids");
    }
    return { tasks: initialTasks, message: "" };
  });
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const deleteRefs = useRef(new Map<string, HTMLButtonElement>());
  const submitted = useRef(false);
  const nextTaskId = useRef(0);
  const inputId = useId();
  const hintId = useId();
  const trimmedName = name.trim();
  const hasName = trimmedName.replace(/\p{Default_Ignorable_Code_Point}/gu, "").trim().length > 0;

  useLayoutEffect(() => {
    if (!state.focusTarget) return;
    const { id } = state.focusTarget;
    (id === null ? inputRef.current : deleteRefs.current.get(id))?.focus();
  }, [state.focusTarget]);

  function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasName || submitted.current) return;
    submitted.current = true;
    let id: string;
    do {
      id = `local-task-${++nextTaskId.current}`;
    } while (state.tasks.some((task) => task.id === id));
    const task = { id, name: trimmedName };
    setState((current) => {
      const tasks = [...current.tasks, task];
      return { tasks, message: `Added ${trimmedName}. ${taskCount(tasks.length)}` };
    });
    setName("");
    inputRef.current?.focus();
  }

  function deleteTask(id: string) {
    setState((current) => {
      const index = current.tasks.findIndex((task) => task.id === id);
      if (index < 0) return current;
      const task = current.tasks[index];
      const neighbor = current.tasks[index + 1] ?? current.tasks[index - 1];
      const tasks = current.tasks.filter((candidate) => candidate.id !== id);
      return {
        tasks,
        message: `Deleted ${task.name}. ${taskCount(tasks.length)}`,
        focusTarget: { id: neighbor?.id ?? null },
      };
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={addTask} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor={inputId}>Task name</Label>
          <Input
            ref={inputRef}
            id={inputId}
            value={name}
            onChange={(event) => {
              submitted.current = false;
              setName(event.target.value);
            }}
            aria-describedby={hintId}
            required
          />
          <p id={hintId} className="text-sm text-muted-foreground">
            Enter a name to enable Add task.
          </p>
        </div>
        <Button type="submit" disabled={!hasName} className="h-auto whitespace-normal">
          Add task
        </Button>
      </form>
      <LiveStatus>{state.message}</LiveStatus>
      <Table>
        <TableCaption>Tasks</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="h-auto whitespace-normal">Task</TableHead>
            <TableHead scope="col" className="h-auto whitespace-normal">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {state.tasks.map((task, index) => (
            <TableRow key={task.id}>
              <TableHead scope="row" className="h-auto whitespace-normal break-words py-2 align-top">
                {task.name}
              </TableHead>
              <TableCell className="w-px align-top">
                <Button
                  ref={(element) => {
                    if (element) deleteRefs.current.set(task.id, element);
                    else deleteRefs.current.delete(task.id);
                  }}
                  type="button"
                  variant="outline"
                  aria-label={`Delete ${task.name}, task ${index + 1} of ${state.tasks.length}`}
                  onClick={() => deleteTask(task.id)}
                  className="h-auto whitespace-normal"
                >
                  Delete
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {state.tasks.length === 0 && (
            <TableRow>
              <TableCell colSpan={2} className="whitespace-normal">
                <EmptyState title="No tasks yet" />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
