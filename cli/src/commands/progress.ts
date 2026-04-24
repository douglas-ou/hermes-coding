/**
 * Progress Command - Append entries to project or task progress files
 *
 * Lightweight command layer that calls progress service functions and formats output.
 * Follows the architectural pattern: Command -> Service -> Infrastructure
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { ExitCode } from '../core/exit-codes';
import { handleError, Errors } from '../core/error-handler';
import { successResponse, outputResponse } from '../core/response-wrapper';
import { createTaskService } from './service-factory';
import { FileSystemService } from '../infrastructure/file-system.service';
import {
  appendToProjectProgress,
  appendToTaskProgress,
} from '../services/progress-txt.service';

export function registerProgressCommands(program: Command, workspaceDir: string): void {
  const taskService = createTaskService(workspaceDir);
  const fileSystem = new FileSystemService();

  const progress = program.command('progress').description('Manage progress files');

  progress
    .command('append <content>')
    .description('Append an entry to a project or task progress file')
    .option('--task <id>', 'Append to task progress file (mutually exclusive with --project)')
    .option('--project', 'Append to project progress file (mutually exclusive with --task)')
    .option('--json', 'Output as JSON')
    .action(async (content: string, options) => {
      try {
        if (options.task && options.project) {
          handleError(
            Errors.invalidInput('--task and --project are mutually exclusive; provide one, not both'),
            options.json
          );
          return;
        }

        if (!options.task && !options.project) {
          handleError(
            Errors.invalidInput('Either --task <id> or --project must be provided'),
            options.json
          );
          return;
        }

        if (options.task) {
          const task = await taskService.getTask(options.task);
          if (!task) {
            handleError(Errors.taskNotFound(options.task), options.json);
            return;
          }

          await appendToTaskProgress(fileSystem, workspaceDir, task.id, task.module, content);

          const response = successResponse({
            target: 'task',
            taskId: task.id,
            module: task.module,
            appended: true,
          });

          outputResponse(response, options.json, (data) => {
            console.log(chalk.green(`Appended to task progress: ${data.taskId}`));
          });
        } else {
          await appendToProjectProgress(fileSystem, workspaceDir, content);

          const response = successResponse({
            target: 'project',
            appended: true,
          });

          outputResponse(response, options.json, (data) => {
            console.log(chalk.green('Appended to project progress'));
          });
        }

        process.exit(ExitCode.SUCCESS);
      } catch (error) {
        handleError(Errors.fileSystemError('Failed to append to progress', error), options.json);
      }
    });
}
