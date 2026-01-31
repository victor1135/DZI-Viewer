import { TestBed } from '@angular/core/testing';

import { Cases } from './cases';

describe('Cases', () => {
  let service: Cases;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Cases);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
