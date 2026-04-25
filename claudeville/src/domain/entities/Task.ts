interface TaskParams {
    id: string;
    subject: string;
    description: string;
    status: string;
    owner: string;
    blockedBy: string[];
    activeForm: string;
}

export class Task {
    id: string;
    subject: string;
    description: string;
    status: string;
    owner: string;
    blockedBy: string[];
    activeForm: string;

    constructor({ id, subject, description, status, owner, blockedBy, activeForm }: TaskParams) {
        this.id = id;
        this.subject = subject;
        this.description = description;
        this.status = status || 'pending';
        this.owner = owner;
        this.blockedBy = blockedBy || [];
        this.activeForm = activeForm;
    }

    get isBlocked() {
        return this.blockedBy.length > 0;
    }

    get isCompleted() {
        return this.status === 'completed';
    }

    get isInProgress() {
        return this.status === 'in_progress';
    }
}
