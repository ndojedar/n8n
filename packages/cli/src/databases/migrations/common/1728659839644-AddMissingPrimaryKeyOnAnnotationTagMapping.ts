import { ApplicationError } from 'n8n-workflow';

import type { IrreversibleMigration, MigrationContext } from '@/databases/types';

export class AddMissingPrimaryKeyOnAnnotationTagMapping1728659839644
	implements IrreversibleMigration
{
	async up({ queryRunner, tablePrefix }: MigrationContext) {
		// Check if the primary key already exists
		const table = await queryRunner.getTable(`${tablePrefix}execution_annotation_tags`);

		if (!table) {
			throw new ApplicationError('execution_annotation_tags table not found');
		}

		const hasPrimaryKey = table.primaryColumns.length > 0;

		if (!hasPrimaryKey) {
			await queryRunner.createPrimaryKey(`${tablePrefix}execution_annotation_tags`, [
				'annotationId',
				'tagId',
			]);
		}
	}
}
