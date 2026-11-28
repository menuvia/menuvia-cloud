import type { Translation } from '../../core'
import type ro from './ro'

// team = team (as `dashboard.nav_echipa`); roles as `invite.role*`.
const en: Translation<typeof ro> = {
  role_owner: 'Owner',
  role_manager: 'Manager',
  role_waiter: 'Waiter',
  role_kitchen: 'Kitchen',

  members_count: {
    one: '{n} member · Invitations expire in 7 days',
    other: '{n} members · Invitations expire in 7 days',
  },
  founder_note:
    'In founder mode you can see the team, but invitations are sent only by the restaurant’s owner or ' +
    'manager, from their own account.',
  invite_title: 'Invite a new member',
  email: 'Email',
  email_placeholder: 'john@restaurant.com',
  role: 'Role',
  sending: 'Sending…',
  send: 'Send invitation',
  inv_sent: 'Invitation sent to {email}',
  inv_revoked: 'Invitation cancelled',
  err_revoke: 'Couldn’t cancel the invitation',
  member_removed: 'Member removed',
  err_remove: 'Couldn’t remove the member',
  owner_forbidden: 'Promoting someone to owner isn’t allowed',
  role_updated: 'Role updated',
  err_role: 'Couldn’t update the role',
  err_load: 'The team couldn’t be loaded',

  inv_err_send: 'Couldn’t send the invitation',
  inv_err_network: 'Connection error. Check your internet connection.',
  inv_err_server_config: 'Invitations aren’t enabled on the server right now. Try again later.',
  inv_err_email_not_configured:
    'Sending emails isn’t enabled right now. Write to us and we’ll help.',
  inv_err_missing_fields: 'Fill in the email address and the role.',
  inv_err_invalid_email: 'The email address isn’t valid.',
  inv_err_invalid_role: 'The chosen role doesn’t exist. Choose Manager, Waiter or Kitchen.',
  inv_err_auth_invalid: 'Your session has expired. Sign in again.',
  inv_err_forbidden: 'Only the owner or the manager can send invitations.',
  inv_err_rate_limit_unavailable:
    'We couldn’t check the invitation limit. Try again in a few moments.',
  inv_err_rate_limited:
    'You’ve sent too many invitations in the last 24 hours. Try again tomorrow or contact support.',
  inv_err_already_member: 'This user is already a member.',
  inv_err_invite_create_failed: 'We couldn’t create the invitation. Try again.',
  inv_err_email_send_uncertain:
    'We couldn’t confirm that the email was sent. The invitation appears in the list; if it doesn’t ' +
    'arrive within a few minutes, send it again.',
  inv_err_email_send_failed: 'The invitation email couldn’t be sent. Try again.',

  pending_title: 'Pending invitations ({n})',
  pending_meta: '{role} · expires {date}',
  current_title: 'Current members ({n})',
  empty_title: 'No members yet',
  empty_desc: 'Invite your colleagues so you can run the restaurant together.',
  user_fallback: 'User',
  self: 'You',
  role_aria: 'Role for {name}',
  remove_aria: 'Remove {name} from the team',
  remove_title: 'Remove from the team',
  remove_confirm: 'Are you sure you want to remove {name}?',
  remove: 'Remove',

  role_confirmTitle: 'Change {name}’s role to {role}?',
  role_confirmOk: 'Change role',
  role_toManager:
    'As a Manager they’ll be able to change the restaurant’s settings, invite and remove team ' +
    'members, and see reports and takings.',
  role_toWaiter: 'They’ll work in the Waiter screen: the tables and their orders.',
  role_toKitchen: 'They’ll work in the Kitchen screen: the orders to prepare.',
  role_fromManager: 'They’ll lose access to settings, the team, reports and takings.',
}

export default en
