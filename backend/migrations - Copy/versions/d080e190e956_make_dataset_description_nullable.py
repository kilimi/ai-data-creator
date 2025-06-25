"""make_dataset_description_nullable

Revision ID: d080e190e956
Revises: 57e2b66fdbf1
Create Date: 2025-04-25 20:37:37.781221

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd080e190e956'
down_revision: Union[str, None] = '57e2b66fdbf1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Make description nullable
    op.alter_column('datasets', 'description',
               existing_type=sa.Text(),
               nullable=True)
    
    # Make tags nullable and convert to JSON
    op.alter_column('datasets', 'tags',
               existing_type=sa.VARCHAR(),
               type_=sa.JSON(),
               nullable=True,
               postgresql_using="tags::json")


def downgrade() -> None:
    # Revert tags to VARCHAR and make non-nullable
    op.alter_column('datasets', 'tags',
               existing_type=sa.JSON(),
               type_=sa.VARCHAR(),
               nullable=False,
               postgresql_using="tags::text")
    
    # Make description non-nullable again
    op.alter_column('datasets', 'description',
               existing_type=sa.Text(),
               nullable=False)
