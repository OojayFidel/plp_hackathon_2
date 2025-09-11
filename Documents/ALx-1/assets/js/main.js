document.addEventListener('DOMContentLoaded', () => {

    /**
     * Handles navigation link highlighting and smooth scrolling.
     */
    const initNavigation = () => {
        const navLinks = document.querySelectorAll('.nav-link');
        const currentPath = window.location.pathname.split('/').pop() || 'index.html';

        navLinks.forEach(link => {
            const linkPath = link.getAttribute('href').split('/').pop();
            if (linkPath === currentPath) {
                link.classList.add('active');
            }

            // Smooth scroll for anchor links
            if (link.hash) {
                link.addEventListener('click', (e) => {
                    const targetId = link.hash;
                    const targetElement = document.querySelector(targetId);
                    if (targetElement) {
                        e.preventDefault();
                        targetElement.scrollIntoView({ behavior: 'smooth' });
                    }
                });
            }
        });
    };
    
    /**
     * Initializes modal dialogs with accessibility features.
     */
    const initModals = () => {
        const modalTriggers = document.querySelectorAll('.modal-trigger');
        const modals = document.querySelectorAll('.modal');
        let previouslyFocusedElement;

        const openModal = (modal) => {
            previouslyFocusedElement = document.activeElement;
            modal.removeAttribute('hidden');
            document.body.classList.add('modal-open');
            modal.querySelector('[aria-label="Close dialog"]').focus();
        };

        const closeModal = (modal) => {
            modal.setAttribute('hidden', 'true');
            document.body.classList.remove('modal-open');
            if (previouslyFocusedElement) {
                previouslyFocusedElement.focus();
            }
        };

        modalTriggers.forEach(trigger => {
            trigger.addEventListener('click', () => {
                const modalId = trigger.dataset.modalId;
                const modal = document.getElementById(modalId);
                if (modal) openModal(modal);
            });
        });

        modals.forEach(modal => {
            const overlay = modal.querySelector('.modal-overlay');
            const closeBtn = modal.querySelector('.modal-close');
            
            overlay.addEventListener('click', () => closeModal(modal));
            closeBtn.addEventListener('click', () => closeModal(modal));

            // Keyboard navigation
            modal.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') closeModal(modal);

                if (e.key === 'Tab') {
                    const focusableElements = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
                    const firstElement = focusableElements[0];
                    const lastElement = focusableElements[focusableElements.length - 1];

                    if (e.shiftKey) { // Shift + Tab
                        if (document.activeElement === firstElement) {
                            lastElement.focus();
                            e.preventDefault();
                        }
                    } else { // Tab
                        if (document.activeElement === lastElement) {
                            firstElement.focus();
                            e.preventDefault();
                        }
                    }
                }
            });
        });
    };

    /**
     * Handles the back-to-top button visibility and functionality.
     */
    const initBackToTopButton = () => {
        const button = document.getElementById('back-to-top');
        if (!button) return;

        window.addEventListener('scroll', () => {
            if (window.scrollY > 400) {
                button.removeAttribute('hidden');
                button.classList.add('visible');
            } else {
                button.setAttribute('hidden', 'true');
                button.classList.remove('visible');
            }
        });

        button.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    };
    
    /**
     * Creates and displays a toast notification.
     * @param {string} message - The message to display.
     */
    const showToast = (message) => {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    };

    /**
     * Initializes all forms on the page with client-side validation.
     */
    const initForms = () => {
        const contactForm = document.getElementById('contact-form');
        if (contactForm) {
            contactForm.addEventListener('submit', (e) => {
                e.preventDefault();
                if (contactForm.checkValidity()) {
                    showToast('Thank you! Your message has been sent.');
                    contactForm.reset();
                } else {
                    showToast('Please fill out all required fields.');
                }
            });
        }
        
        const notifyForm = document.getElementById('notify-form');
        if (notifyForm) {
            notifyForm.addEventListener('submit', (e) => {
                e.preventDefault();
                if (notifyForm.checkValidity()) {
                    showToast("Thanks! We'll notify you when the video is live.");
                    notifyForm.reset();
                }
            });
        }
    };
    
    /**
     * Initializes the portfolio filtering functionality.
     */
    const initPortfolioFilter = () => {
        const filterControls = document.querySelector('.filter-controls');
        if (!filterControls) return;

        const filterBtns = filterControls.querySelectorAll('.filter-btn');
        const projectCards = document.querySelectorAll('.portfolio-grid .project-card');

        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                // Update active button
                filterControls.querySelector('.active').classList.remove('active');
                btn.classList.add('active');

                const filterValue = btn.dataset.filter;

                projectCards.forEach(card => {
                    if (filterValue === 'all' || card.dataset.category === filterValue) {
                        card.style.display = 'flex';
                    } else {
                        card.style.display = 'none';
                    }
                });
            });
        });
    };


    // Run all initialization functions
    initNavigation();
    initModals();
    initBackToTopButton();
    initForms();
    initPortfolioFilter();
});