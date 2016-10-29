var Glavred = require("../../lib/glvrd");

describe("Glavred HTTP API integration.", () => {
    let glvrd = new Glavred("Test App");

    it("Saves app string after creation.", () => {
        new Glavred("Another Test App");
        expect(glvrd.app).toBe("Test App");
    });

    it("Handles error when app name was not defined.", (done) => {
        // Create object with empty app string.
        let glvrd = new Glavred();

        glvrd.getStatus().catch((response) => {
            expect(response.status).toBe('error');
            expect(response.code).toBe('missing_param');
            done();
        });
    });

    it("Can check glavred status.", (done) => {
        glvrd.getStatus().then((response) => {
            expect(response.status).toBe('ok');
            done();
        });
    });

    it("Session is reused after first request.", (done) => {
        glvrd.checkSession().then((response) => {
            expect(response.status).toBe('ok');
            expect(response.session).toBe(glvrd.session);
            var firstSession = glvrd.session;
            glvrd.checkSession().then((response) => {
                expect(response.cached).toBe(true);
                expect(response.session).toBe(firstSession);
                done();
            });
        });
    });

    // TODO: empty text in proofreading.

    it("Proofreads text.", (done) => {
        glvrd.proofread("Редактор суть писатель.", true).then((response) => {
            expect(response.cached).toBeUndefined();
            expect(response.status).toBe('ok');
            expect(response.fragments.length).toBe(1);
            expect(response.fragments[0].start).toBe(9);
            expect(response.fragments[0].end).toBe(13);
            expect(response.fragments[0].hint_id).not.toBeUndefined();
            done();
        });
    });

    it("Loads proper hints.", (done) => {
        glvrd.proofread("Одной из важных.", true).then((response) => {
            glvrd.getHints([response.fragments[0].hint_id, response.fragments[1].hint_id]).then((hints) => {
                expect(typeof hints).toBe("object");
                done();
            });
        });
    });

    it("Counts proper score.", (done) => {
        let text = "Можно ли представить современный мир без ссылок? Едва ли. И до недавнего времени сервис «Главред» никак не отвечал на вызовы времени, связанные с необходимостью создания гипертекстовых связей в Глобальной паутине.";
        glvrd.proofread(text, true).then((response) => {
            expect(response.fragments[0].hint).toBeUndefined();
            expect(response.score).toBeUndefined();

            var score = glvrd.getScore(response);
            expect(score).toBe(4.5);

            done();
        });
    });

    it("Decorates profread text with hint texts.", (done) => {
        glvrd.proofread("Одной из важных.").then((response) => {
            expect(typeof response.fragments[0].hint).toBe("object");
            expect(response.fragments[0].hint.name).toBe("Неопределенность");
            expect(response.fragments[0].hint.description).toBe("Неинформативно. Уберите или уточните");
            expect(response.score).toBe(0.3);
            done();
        });
    });
});