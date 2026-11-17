import { groupId, isPortfolio, nestedGroupId, projectId, Task } from "./tasks";

/**
 * Work breakdown structure numbers: groups and ungrouped tasks are numbered 1, 2, 3 in the order
 * they appear, and the tasks in a group 1.1, 1.2 and so on. Numbered over all tasks, so a number
 * stays the same while groups are collapsed or the list is filtered. In the 2.3 portfolio view the
 * projects come first: project 2, its group 2.1 and that group's tasks 2.1.1, 2.1.2.
 */
export function wbsNumbers(tasks: Task[]): Map<string, string> {
    const numbers = new Map<string, string>();
    if (!isPortfolio(tasks)) {
        numberLevel(tasks, "", groupId, numbers);
        return numbers;
    }
    let top = 0;
    const projects = new Map<string, Task[]>();
    const groups = new Map<string, { number: number; count: number }>();
    const order: Array<{ project?: string; task?: Task }> = [];
    tasks.forEach(task => {
        if (task.project) {
            if (!projects.has(task.project)) {
                projects.set(task.project, []);
                order.push({ project: task.project });
            }
            projects.get(task.project)!.push(task);
        } else {
            order.push({ task });
        }
    });
    order.forEach(entry => {
        if (entry.project !== undefined) {
            top++;
            const prefix = `${top}.`;
            numbers.set(projectId(entry.project), String(top));
            const project = entry.project;
            numberLevel(projects.get(project)!, prefix, name => nestedGroupId(project, name), numbers);
            return;
        }
        const task = entry.task!;
        if (!task.group) {
            top++;
            numbers.set(task.id, String(top));
            return;
        }
        let group = groups.get(task.group);
        if (!group) {
            top++;
            group = { number: top, count: 0 };
            groups.set(task.group, group);
            numbers.set(groupId(task.group), String(top));
        }
        group.count++;
        numbers.set(task.id, `${group.number}.${group.count}`);
    });
    return numbers;
}

function numberLevel(
    tasks: Task[],
    prefix: string,
    idOf: (name: string) => string,
    numbers: Map<string, string>
): void {
    const groups = new Map<string, { number: number; count: number }>();
    let top = 0;
    tasks.forEach(task => {
        if (!task.group) {
            top++;
            numbers.set(task.id, `${prefix}${top}`);
            return;
        }
        let group = groups.get(task.group);
        if (!group) {
            top++;
            group = { number: top, count: 0 };
            groups.set(task.group, group);
            numbers.set(idOf(task.group), `${prefix}${top}`);
        }
        group.count++;
        numbers.set(task.id, `${prefix}${group.number}.${group.count}`);
    });
}
