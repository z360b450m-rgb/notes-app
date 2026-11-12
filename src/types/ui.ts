export interface ActionMenuAction {
  id: string
  label: string
  icon?:
    | 'save'
    | 'download'
    | 'upload'
    | 'text'
    | 'pdf'
    | 'delete'
    | 'edit'
    | 'add'
    | 'tag'
    | 'clear'
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
}
